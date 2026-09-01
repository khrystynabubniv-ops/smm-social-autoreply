import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { sendReplyToMeta } from "@/lib/meta";
import {
  answerCallbackQuery,
  buildSendEditedKeyboard,
  editMessageText,
  sendMessage,
} from "@/lib/telegram";
import { getEnv } from "@/lib/env";
import { escapeHtml } from "@/lib/escapeHtml";
import { isValidTelegramSecret } from "@/lib/telegramSecret";

type TelegramUpdate = {
  message?: {
    message_id: number;
    chat: { id: number };
    text?: string;
    reply_to_message?: { message_id: number };
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
    default:
      await answerCallbackQuery(callbackQuery.id);
  }
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
    await editMessageText(
      String(callbackQuery.message.chat.id),
      updated.telegramMessageId,
      `${buildOriginalText(updated)}\n\n✅ Надіслано о ${sentAt}`,
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

  await prisma.incomingEvent.update({
    where: { id: eventId },
    data: { awaitingEditReply: true },
  });

  await answerCallbackQuery(callbackQuery.id);

  const { TELEGRAM_CHAT_ID } = getEnv();
  await sendMessage(
    TELEGRAM_CHAT_ID,
    "Напишіть виправлений варіант відповіді:",
    {
      forceReply: true,
    },
  );
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

  const { TELEGRAM_CHAT_ID } = getEnv();
  await sendMessage(TELEGRAM_CHAT_ID, buildEditedDraftText(updated, draft), {
    inlineKeyboard: buildSendEditedKeyboard(updated.id),
  });
}

const STATUS_LABEL: Record<string, string> = {
  sent: "вже позначена як надіслана",
  edited_sent: "вже позначена як надіслана (з попередньою правкою)",
};

// Deliberately doesn't repeat the original message text — that's already
// visible in the card above in the same chat. Re-quoting it here made this
// look like a duplicate notification instead of a new step in the same flow.
function buildEditedDraftText(
  event: {
    source: string;
    senderUsername: string | null;
    senderId: string;
    status: string;
  },
  draft: string,
): string {
  const kind = event.source === "instagram_dm" ? "DM" : "коментар";
  const username = event.senderUsername
    ? `@${escapeHtml(event.senderUsername)}`
    : escapeHtml(event.senderId);

  const statusWarning = STATUS_LABEL[event.status]
    ? `⚠️ Ця подія ${STATUS_LABEL[event.status]} — надсилання зараз повторить відповідь ще раз.\n\n`
    : "";

  return `${statusWarning}✏️ Новий варіант відповіді (${kind} від ${username}):\n"${escapeHtml(draft)}"`;
}

// event.text / senderUsername / senderId come straight from the Meta webhook
// payload (an arbitrary public IG comment or DM) and messages are sent with
// parse_mode: "HTML" — must be escaped before interpolation to avoid HTML/link
// injection into the operator's Telegram chat.
function buildOriginalText(event: {
  source: string;
  senderUsername: string | null;
  senderId: string;
  text: string;
}): string {
  const kind = event.source === "instagram_dm" ? "DM" : "коментар";
  const username = event.senderUsername
    ? `@${escapeHtml(event.senderUsername)}`
    : escapeHtml(event.senderId);
  return `💬 ${kind} від ${username}\n"${escapeHtml(event.text)}"`;
}
