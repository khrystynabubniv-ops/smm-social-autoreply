/**
 * Re-sends an IncomingEvent's current card to an additional Telegram chat —
 * useful when someone new joins TELEGRAM_CHAT_IDS and missed earlier cards.
 * Merges the new message into telegramMessageIds so future edits (send/
 * edit/mark_processed) sync to this chat too, same as any other recipient.
 *
 * Usage: npx tsx scripts/resend-to-chat.ts <chatId> [eventId]
 * (eventId defaults to the most recent event if omitted)
 *
 * Only runs with real DB/Telegram access — this machine's local network
 * can't reach the production Postgres directly, so run this via a
 * temporary addition to the Railway preDeployCommand, e.g.:
 *   npx prisma migrate deploy && npx prisma db seed && npx tsx scripts/resend-to-chat.ts <chatId>
 * then revert preDeployCommand back to normal afterward.
 */
import { prisma } from "../src/lib/prisma";
import { buildCardText, getEventTemplate } from "../src/lib/eventCard";
import { keyboardForTier } from "../src/lib/notify";
import { sendMessage } from "../src/lib/telegram";
import type { Prisma } from "@prisma/client";

async function main() {
  const [chatId, eventId] = process.argv.slice(2);
  if (!chatId) {
    console.error(
      "[resend] usage: npx tsx scripts/resend-to-chat.ts <chatId> [eventId]",
    );
    process.exit(1);
  }

  const event = eventId
    ? await prisma.incomingEvent.findUnique({ where: { id: eventId } })
    : await prisma.incomingEvent.findFirst({ orderBy: { createdAt: "desc" } });

  if (!event) {
    console.log("[resend] no matching event found");
    return;
  }

  const template = await getEventTemplate(event);
  const sent = await sendMessage(chatId, buildCardText(event, template), {
    inlineKeyboard: keyboardForTier(event),
  });

  const existing: Prisma.JsonObject =
    event.telegramMessageIds &&
    typeof event.telegramMessageIds === "object" &&
    !Array.isArray(event.telegramMessageIds)
      ? (event.telegramMessageIds as Prisma.JsonObject)
      : {};

  await prisma.incomingEvent.update({
    where: { id: event.id },
    data: { telegramMessageIds: { ...existing, [chatId]: sent.message_id } },
  });

  console.log(
    `[resend] sent event ${event.id} (${event.source}, "${event.text.slice(0, 40)}...") to chat ${chatId}, message_id ${sent.message_id}`,
  );
}

main()
  .catch((err) => {
    console.error("[resend] failed", err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
