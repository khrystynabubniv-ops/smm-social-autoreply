import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendReplyToMeta } from "@/lib/meta";
import {
  answerCallbackQuery,
  buildSendEditedKeyboard,
  editMessageText,
} from "@/lib/telegram";
import { buildCardText, getEventTemplate } from "@/lib/eventCard";
import { getEnv } from "@/lib/env";
import { isValidTelegramSecret } from "@/lib/telegramSecret";
import type { IncomingEvent } from "@prisma/client";

type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
  };
  callback_query?: {
    id: string;
    data?: string;
    message?: { message_id: number; chat: { id: number } };
  };
};

export async function POST(request: NextRequest) {
  // Telegram has no HMAC-over-body mechanism; the secret_token header (set via
  // setWebhook) is the only proof a request actually came from Telegram.
  if (
    !isValidTelegramSecret(
      request.headers.get("x-telegram-bot-api-secret-token"),
    )
  ) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const { TELEGRAM_CHAT_ID } = getEnv();

  // Defense in depth: only ever act on updates from the configured admin chat.
  const chatId =
    update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  if (String(chatId) !== TELEGRAM_CHAT_ID) {
    return new NextResponse("OK", { status: 200 });
  }

  try {
    if (update.callback_query) {
      await handleCallbackQuery(update.callback_query);
    } else if (update.message?.text) {
      await handleTextMessage(update.message);
    }
  } catch (err) {
    console.error("[webhook:telegram] failed to handle update", err);
  }

  // Telegram only cares that we respond 200; body content is ignored.
  return new NextResponse("OK", { status: 200 });
}

async function handleCallbackQuery(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
) {
  const data = callbackQuery.data ?? "";
  const [action, eventId] = data.split(":");

  if (!eventId) {
    await answerCallbackQuery(callbackQuery.id);
    return;
  }

  switch (action) {
    case "send":
      await handleSend(callbackQuery, eventId, { edited: false });
      break;
    case "edit":
      await handleEditRequest(callbackQuery, eventId);
      break;
    case "send_edited":
      await handleSend(callbackQuery, eventId, { edited: true });
      break;
    case "mark_processed":
      await handleMarkProcessed(callbackQuery, eventId);
      break;
    default:
      await answerCallbackQuery(callbackQuery.id);
  }
}

/** Edits the one Telegram message that represents this event, in place. */
async function updateCard(
  event: IncomingEvent,
  chatId: string,
  extra?: string,
  options?: Parameters<typeof editMessageText>[3],
) {
  if (!event.telegramMessageId) return;
  const template = await getEventTemplate(event);
  await editMessageText(
    chatId,
    event.telegramMessageId,
    buildCardText(event, template, extra),
    options,
  );
}

async function handleSend(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  eventId: string,
  { edited }: { edited: boolean },
) {
  const event = await prisma.incomingEvent.findUnique({
    where: { id: eventId },
  });
  if (!event) {
    await answerCallbackQuery(callbackQuery.id, "Подію не знайдено");
    return;
  }

  const replyText = event.proposedReply ?? "";

  try {
    await sendReplyToMeta(event, replyText);
  } catch (err) {
    console.error(
      `[webhook:telegram] failed to send reply for event ${eventId}`,
      err,
    );
    await answerCallbackQuery(
      callbackQuery.id,
      "❌ Помилка надсилання в Meta — див. логи",
    );
    return;
  }

  const updated = await prisma.incomingEvent.update({
    where: { id: eventId },
    data: {
      status: edited ? "edited_sent" : "sent",
      finalReply: replyText,
      awaitingEditReply: false,
    },
  });

  await answerCallbackQuery(callbackQuery.id, "Надіслано ✅");

  if (updated.telegramMessageId && callbackQuery.message) {
    const sentAt = new Date().toLocaleTimeString("uk-UA", {
      hour: "2-digit",
      minute: "2-digit",
    });
    await updateCard(
      updated,
      String(callbackQuery.message.chat.id),
      `✅ Надіслано о ${sentAt}`,
      { inlineKeyboard: [] },
    );
  }
}

async function handleEditRequest(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  eventId: string,
) {
  const event = await prisma.incomingEvent.findUnique({
    where: { id: eventId },
  });
  if (!event) {
    await answerCallbackQuery(callbackQuery.id, "Подію не знайдено");
    return;
  }

  const updated = await prisma.incomingEvent.update({
    where: { id: eventId },
    data: { awaitingEditReply: true },
  });

  await answerCallbackQuery(callbackQuery.id);

  if (updated.telegramMessageId && callbackQuery.message) {
    // Edit the same card in place — buttons removed while we wait for the
    // operator's next plain text message in this chat to be the correction.
    await updateCard(
      updated,
      String(callbackQuery.message.chat.id),
      "✏️ Напишіть новий варіант відповіді наступним повідомленням у цей чат.",
      { inlineKeyboard: [] },
    );
  }
}

/** Tier C — dismiss without sending anything to Meta; reference only. */
async function handleMarkProcessed(
  callbackQuery: NonNullable<TelegramUpdate["callback_query"]>,
  eventId: string,
) {
  const event = await prisma.incomingEvent.findUnique({
    where: { id: eventId },
  });
  if (!event) {
    await answerCallbackQuery(callbackQuery.id, "Подію не знайдено");
    return;
  }

  const updated = await prisma.incomingEvent.update({
    where: { id: eventId },
    data: { status: "processed" },
  });

  await answerCallbackQuery(callbackQuery.id, "Опрацьовано ✅");

  if (updated.telegramMessageId && callbackQuery.message) {
    await updateCard(
      updated,
      String(callbackQuery.message.chat.id),
      "✅ Позначено як опрацьоване",
      { inlineKeyboard: [] },
    );
  }
}

async function handleTextMessage(
  message: NonNullable<TelegramUpdate["message"]>,
) {
  // Find the (single, by design) event currently waiting on an edit reply.
  const event = await prisma.incomingEvent.findFirst({
    where: { awaitingEditReply: true },
    orderBy: { updatedAt: "desc" },
  });

  if (!event) return; // not a reply we care about

  const draft = message.text ?? "";

  const updated = await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { proposedReply: draft, awaitingEditReply: false },
  });

  // Fold the correction back into the same card instead of sending a new
  // message — one Telegram message per Instagram interaction, always.
  await updateCard(updated, String(message.chat.id), undefined, {
    inlineKeyboard: buildSendEditedKeyboard(updated.id),
  });
}
