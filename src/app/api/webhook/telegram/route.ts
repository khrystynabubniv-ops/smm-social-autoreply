import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendReplyToMeta } from "@/lib/meta";
import {
  answerCallbackQuery,
  buildSendEditedKeyboard,
  editMessageInChats,
  getChatIds,
  type ChatMessageMap,
} from "@/lib/telegram";
import { buildCardText, getEventTemplate } from "@/lib/eventCard";
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

  // Defense in depth: only ever act on updates from a configured chat.
  const chatId =
    update.callback_query?.message?.chat.id ?? update.message?.chat.id;
  if (!chatId || !getChatIds().includes(String(chatId))) {
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

function messageIdsOf(event: IncomingEvent): ChatMessageMap {
  const raw = event.telegramMessageIds;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  return raw as ChatMessageMap;
}

/**
 * Edits every recipient's copy of the one Telegram message that represents
 * this event, in place — whichever chat an action was triggered from, every
 * other configured chat sees the same updated state.
 */
async function updateCard(
  event: IncomingEvent,
  extra?: string,
  options?: Parameters<typeof editMessageInChats>[2],
) {
  const messageIds = messageIdsOf(event);
  if (Object.keys(messageIds).length === 0) return;
  const template = await getEventTemplate(event);
  await editMessageInChats(
    messageIds,
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

  const sentAt = new Date().toLocaleTimeString("uk-UA", {
    hour: "2-digit",
    minute: "2-digit",
  });
  await updateCard(updated, `✅ Надіслано о ${sentAt}`, { inlineKeyboard: [] });
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

  // Edit every copy in place — buttons removed while we wait for the next
  // plain text message (from any configured chat) to be the correction.
  await updateCard(
    updated,
    "✏️ Напишіть новий варіант відповіді наступним повідомленням у цей чат.",
    { inlineKeyboard: [] },
  );
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

  await updateCard(updated, "✅ Позначено як опрацьоване", {
    inlineKeyboard: [],
  });
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

  // Fold the correction back into every copy instead of sending a new
  // message — one Telegram message per Instagram interaction, always.
  await updateCard(updated, undefined, {
    inlineKeyboard: buildSendEditedKeyboard(updated.id),
  });
}
