import { escapeHtml } from "@/lib/escapeHtml";
import { prisma } from "@/lib/prisma";
import type { Template } from "@prisma/client";

const SOURCE_LABEL: Record<string, string> = {
  instagram_dm: "DM",
  instagram_comment: "коментар",
};

const TIER_LABEL: Record<string, string> = {
  A: "низький ризик",
  B: "сенситив",
};

export type CardEvent = {
  source: string;
  senderUsername: string | null;
  senderId: string;
  text: string;
  proposedReply: string | null;
  categoryId: string | null;
  tier: string | null;
  confidence: number | null;
};

/** Looks up the Template row for an event's category, if any — used to know
 * hasPlaceholder / show the Tier C reference examples when rendering a card. */
export async function getEventTemplate(event: {
  categoryId: string | null;
}): Promise<Template | null> {
  if (!event.categoryId) return null;
  return prisma.template.findUnique({
    where: { categoryId: event.categoryId },
  });
}

function usernameLabel(event: CardEvent): string {
  return event.senderUsername
    ? `@${escapeHtml(event.senderUsername)}`
    : escapeHtml(event.senderId);
}

/**
 * Renders the single Telegram message representing one IncomingEvent.
 * The same card is edited in place through its whole lifecycle (new ->
 * editing -> sent) rather than spawning a new message per step, so an
 * operator always sees exactly one message per Instagram interaction.
 *
 * Rendering branches by tier:
 * - Tier C (toxic/critical): different header, reference examples instead of
 *   a proposed reply — never a "send" affordance.
 * - escalate / unclassified with no reply yet: flagged for a from-scratch
 *   human answer, no proposed-reply section.
 * - Everything else (Tier A/B, or escalate once the operator has typed a
 *   manual reply): normal card with a proposed reply.
 */
export function buildCardText(
  event: CardEvent,
  template: Template | null,
  extra?: string,
): string {
  if (event.tier === "C") return buildTierCText(event, template, extra);

  const kind = SOURCE_LABEL[event.source] ?? event.source;
  const username = usernameLabel(event);

  const lines = [
    `💬 ${kind} від ${username}`,
    `"${escapeHtml(event.text)}"`,
    "",
  ];

  const needsManualReply =
    (event.tier === "escalate" || !event.tier) && !event.proposedReply;

  if (needsManualReply) {
    lines.push(
      event.categoryId
        ? `Категорія: ${escapeHtml(event.categoryId)} (низька впевненість${
            event.confidence != null ? ` ${event.confidence.toFixed(2)}` : ""
          } — потрібна ручна відповідь)`
        : "Категорія: не визначено — потрібна ручна відповідь",
    );
    lines.push("", "⚠️ Автоматичну відповідь не підібрано — напиши свою.");
  } else {
    const categoryLine =
      event.tier === "A" || event.tier === "B"
        ? `Категорія: ${escapeHtml(event.categoryId ?? "?")} (Tier ${event.tier} — ${TIER_LABEL[event.tier]})`
        : `Категорія: ${escapeHtml(event.categoryId ?? "не визначено")} (ручна відповідь)`;
    lines.push(categoryLine);
    lines.push(
      "",
      "Пропонована відповідь:",
      `"${escapeHtml(event.proposedReply ?? "")}"`,
    );
    if (template?.hasPlaceholder) {
      lines.push("", "⚠️ Перевір дані перед відправкою.");
    }
  }

  if (extra) lines.push("", extra);

  return lines.join("\n");
}

function buildTierCText(
  event: CardEvent,
  template: Template | null,
  extra?: string,
): string {
  const kind = SOURCE_LABEL[event.source] ?? event.source;
  const username = usernameLabel(event);

  const lines = [
    `🥊 Токсичний/критичний ${kind} від ${username}`,
    `"${escapeHtml(event.text)}"`,
    "",
    `Категорія: ${escapeHtml(event.categoryId ?? "не визначено")}`,
  ];

  if (event.proposedReply) {
    // Operator wrote a real reply via "✏️ Написати відповідь" — show it
    // instead of the reference list once there's an actual answer to send.
    lines.push("", "Відповідь:", `"${escapeHtml(event.proposedReply)}"`);
  } else if (template && template.textVariants.length > 0) {
    lines.push("", "Можливі приклади відповідей з FAQ (для довідки):");
    template.textVariants.forEach((variant, i) => {
      lines.push(`${i + 1}. "${escapeHtml(variant)}"`);
    });
  }

  if (extra) lines.push("", extra);

  return lines.join("\n");
}
