import { getEnv } from "@/lib/env";
import { buildCardText } from "@/lib/eventCard";
import { prisma } from "@/lib/prisma";
import {
  buildConfirmationKeyboard,
  buildEscalateKeyboard,
  buildTierCKeyboard,
  sendMessage,
} from "@/lib/telegram";
import type { IncomingEvent, Template } from "@prisma/client";

function keyboardForTier(event: IncomingEvent) {
  if (event.tier === "C") return buildTierCKeyboard(event.id);
  if (event.tier === "escalate" || !event.tier)
    return buildEscalateKeyboard(event.id);
  return buildConfirmationKeyboard(event.id);
}

/**
 * Sends the confirmation card for a newly stored + classified IncomingEvent
 * to the configured Telegram chat, and stores the resulting message id —
 * this same message is edited in place for every later step (edit / send)
 * instead of spawning new ones.
 */
export async function notifyTelegram(
  event: IncomingEvent,
  template: Template | null,
): Promise<void> {
  const { TELEGRAM_CHAT_ID } = getEnv();

  const sent = await sendMessage(
    TELEGRAM_CHAT_ID,
    buildCardText(event, template),
    {
      inlineKeyboard: keyboardForTier(event),
    },
  );

  await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { telegramMessageId: String(sent.message_id) },
  });
}
