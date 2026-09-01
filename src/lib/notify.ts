import { buildCardText } from "@/lib/eventCard";
import { prisma } from "@/lib/prisma";
import {
  buildConfirmationKeyboard,
  buildEscalateKeyboard,
  buildTierCKeyboard,
  getChatIds,
  sendMessageToChats,
} from "@/lib/telegram";
import type { IncomingEvent, Template } from "@prisma/client";

export function keyboardForTier(event: IncomingEvent) {
  if (event.tier === "C") return buildTierCKeyboard(event.id);
  if (event.tier === "escalate" || !event.tier)
    return buildEscalateKeyboard(event.id);
  return buildConfirmationKeyboard(event.id);
}

/**
 * Sends the confirmation card for a newly stored + classified IncomingEvent
 * to every configured Telegram chat, and stores each chat's message id —
 * every copy is edited in place for every later step (edit / send) instead
 * of spawning new ones, so all recipients always see the same state.
 */
export async function notifyTelegram(
  event: IncomingEvent,
  template: Template | null,
): Promise<void> {
  const messageIds = await sendMessageToChats(
    getChatIds(),
    buildCardText(event, template),
    { inlineKeyboard: keyboardForTier(event) },
  );

  await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { telegramMessageIds: messageIds },
  });
}
