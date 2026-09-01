import { escapeHtml } from "@/lib/escapeHtml";

const SOURCE_LABEL: Record<string, string> = {
  instagram_dm: "DM",
  instagram_comment: "коментар",
};

const STATUS_WARNING: Record<string, string> = {
  sent: "⚠️ Цю подію вже позначено як надіслану — повторне надсилання відправить відповідь ще раз.\n\n",
  edited_sent:
    "⚠️ Цю подію вже позначено як надіслану (з попередньою правкою) — повторне надсилання відправить відповідь ще раз.\n\n",
};

export type CardEvent = {
  source: string;
  senderUsername: string | null;
  senderId: string;
  text: string;
  proposedReply: string | null;
  status: string;
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

  const warning = STATUS_WARNING[event.status] ?? "";

  const lines = [
    `${warning}💬 ${kind} від ${username}`,
    `"${escapeHtml(event.text)}"`,
    "",
    "Пропонована відповідь:",
    `"${escapeHtml(event.proposedReply ?? "")}"`,
  ];

  if (extra) lines.push("", extra);

  return lines.join("\n");
}
