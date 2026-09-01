import { getEnv } from "@/lib/env";

const TELEGRAM_API_BASE = "https://api.telegram.org";

type InlineKeyboardButton = {
  text: string;
  callback_data: string;
};

type TelegramApiResponse<T> = {
  ok: boolean;
  result?: T;
  description?: string;
};

function apiUrl(method: string): string {
  const { TELEGRAM_BOT_TOKEN } = getEnv();
  return `${TELEGRAM_API_BASE}/bot${TELEGRAM_BOT_TOKEN}/${method}`;
}

async function callTelegram<T>(
  method: string,
  body: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(apiUrl(method), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const data = (await res.json()) as TelegramApiResponse<T>;
  if (!data.ok) {
    throw new Error(
      `Telegram API error on ${method}: ${data.description ?? "unknown error"}`,
    );
  }
  return data.result as T;
}

export type SentMessage = { message_id: number };

/** Sends a plain text message, optionally with an inline keyboard. */
export async function sendMessage(
  chatId: string,
  text: string,
  options?: { inlineKeyboard?: InlineKeyboardButton[][]; forceReply?: boolean },
): Promise<SentMessage> {
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "HTML",
  };

  if (options?.inlineKeyboard) {
    body.reply_markup = { inline_keyboard: options.inlineKeyboard };
  } else if (options?.forceReply) {
    body.reply_markup = { force_reply: true, selective: true };
  }

  return callTelegram<SentMessage>("sendMessage", body);
}

/** Edits an existing message's text (used to remove buttons after an action). */
export async function editMessageText(
  chatId: string,
  messageId: string | number,
  text: string,
  options?: { inlineKeyboard?: InlineKeyboardButton[][] },
): Promise<void> {
  await callTelegram("editMessageText", {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: "HTML",
    reply_markup: options?.inlineKeyboard
      ? { inline_keyboard: options.inlineKeyboard }
      : undefined,
  });
}

/** Acknowledges a callback query so Telegram stops showing the loading spinner on the button. */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string,
): Promise<void> {
  await callTelegram("answerCallbackQuery", {
    callback_query_id: callbackQueryId,
    text,
  });
}

export function buildConfirmationKeyboard(
  eventId: string,
): InlineKeyboardButton[][] {
  return [
    [
      { text: "✅ Надіслати", callback_data: `send:${eventId}` },
      { text: "✏️ Редагувати", callback_data: `edit:${eventId}` },
    ],
  ];
}

export function buildSendEditedKeyboard(
  eventId: string,
): InlineKeyboardButton[][] {
  return [
    [
      {
        text: "✅ Надіслати цей варіант",
        callback_data: `send_edited:${eventId}`,
      },
    ],
  ];
}

/** Tier "escalate" — no auto-picked template exists, only a from-scratch reply. */
export function buildEscalateKeyboard(
  eventId: string,
): InlineKeyboardButton[][] {
  return [
    [{ text: "✏️ Написати відповідь", callback_data: `edit:${eventId}` }],
  ];
}

/**
 * Tier C (toxic/critical) — never an auto-picked reply, but per the FAQ's own
 * playbook some of these DO warrant a real answer ("брехня про нас/наші
 * процеси — відповідаємо"), just always hand-written and reviewed. Reuses
 * the generic edit -> send_edited flow; "Позначити як опрацьовано" stays for
 * the ones that should just be dismissed (pure insults, baseless negativity).
 */
export function buildTierCKeyboard(eventId: string): InlineKeyboardButton[][] {
  return [
    [{ text: "✏️ Написати відповідь", callback_data: `edit:${eventId}` }],
    [
      {
        text: "✅ Позначити як опрацьовано",
        callback_data: `mark_processed:${eventId}`,
      },
    ],
  ];
}
