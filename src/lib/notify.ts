import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { buildConfirmationKeyboard, sendMessage } from "@/lib/telegram";
import type { IncomingEvent } from "@prisma/client";

const SOURCE_LABEL: Record<string, string> = {
  instagram_dm: "DM",
  instagram_comment: "коментар",
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function buildNotificationText(event: IncomingEvent): string {
  const kind = SOURCE_LABEL[event.source] ?? event.source;
  const username = event.senderUsername
    ? `@${event.senderUsername}`
    : event.senderId;

  return [
    `💬 Нове ${kind} від ${escapeHtml(username)}`,
    `"${escapeHtml(event.text)}"`,
    "",
    "Пропонована відповідь:",
    `"${escapeHtml(event.proposedReply ?? "")}"`,
  ].join("\n");
}

/**
 * Sends the confirmation card for a newly stored IncomingEvent to the configured
 * Telegram chat, and stores the resulting message id for later editing.
 */
export async function notifyTelegram(event: IncomingEvent): Promise<void> {
  const { TELEGRAM_CHAT_ID } = getEnv();

  const sent = await sendMessage(
    TELEGRAM_CHAT_ID,
    buildNotificationText(event),
    {
      inlineKeyboard: buildConfirmationKeyboard(event.id),
    },
  );

  await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { telegramMessageId: String(sent.message_id) },
  });
}
