import { escapeHtml } from "@/lib/escapeHtml";

const SOURCE_LABEL: Record<string, string> = {
  instagram_dm: "DM",
  instagram_comment: "коментар",
};

export type CardEvent = {
  source: string;
  senderUsername: string | null;
  senderId: string;
  text: string;
  proposedReply: string | null;
};

/**
 * Renders the single Telegram message representing one IncomingEvent.
 * The same card is edited in place through its whole lifecycle (new ->
 * editing -> sent) rather than spawning a new message per step, so an
 * operator always sees exactly one message per Instagram interaction.
 */
export function buildCardText(event: CardEvent, extra?: string): string {
  const kind = SOURCE_LABEL[event.source] ?? event.source;
  const username = event.senderUsername
    ? `@${escapeHtml(event.senderUsername)}`
    : escapeHtml(event.senderId);

  const lines = [
    `💬 ${kind} від ${username}`,
    `"${escapeHtml(event.text)}"`,
    "",
    "Пропонована відповідь:",
    `"${escapeHtml(event.proposedReply ?? "")}"`,
  ];

  if (extra) lines.push("", extra);

  return lines.join("\n");
}
