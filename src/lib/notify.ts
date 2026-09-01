import { getEnv } from "@/lib/env";
import { buildCardText } from "@/lib/eventCard";
import { prisma } from "@/lib/prisma";
import { buildConfirmationKeyboard, sendMessage } from "@/lib/telegram";
import type { IncomingEvent } from "@prisma/client";

/**
 * Sends the confirmation card for a newly stored IncomingEvent to the configured
 * Telegram chat, and stores the resulting message id — this same message is
 * edited in place for every later step (edit / send) instead of spawning new ones.
 */
export async function notifyTelegram(event: IncomingEvent): Promise<void> {
  const { TELEGRAM_CHAT_ID } = getEnv();

  const sent = await sendMessage(TELEGRAM_CHAT_ID, buildCardText(event), {
    inlineKeyboard: buildConfirmationKeyboard(event.id),
  });

  await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { telegramMessageId: String(sent.message_id) },
  });
}
