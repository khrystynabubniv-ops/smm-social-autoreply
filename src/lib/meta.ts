import { getEnv } from "@/lib/env";
import type { IncomingEvent } from "@prisma/client";

const GRAPH_API_BASE = "https://graph.facebook.com/v21.0";

/**
 * Sends the final reply back to Meta.
 *
 * - instagram_comment: real call to the Graph API `/{comment-id}/replies` endpoint,
 *   since `instagram_manage_comments` is already an approved permission.
 * - instagram_dm: stub only (console.log) until `instagram_manage_messages` is
 *   approved for this app — replace the branch body with a real
 *   `/me/messages` call once that happens.
 */
export async function sendReplyToMeta(
  event: IncomingEvent,
  replyText: string,
): Promise<void> {
  if (event.source === "instagram_comment") {
    await replyToComment(event.externalId, replyText);
    return;
  }

  if (event.source === "instagram_dm") {
    // TODO: replace with a real POST to /me/messages once instagram_manage_messages is approved.
    console.log(
      `[meta:dm-stub] Would send DM reply to ${event.senderId} (event ${event.id}): "${replyText}"`,
    );
    return;
  }

  console.warn(
    `[meta] Unknown event source "${event.source}" for event ${event.id}, skipping send.`,
  );
}

async function replyToComment(
  commentId: string,
  message: string,
): Promise<void> {
  const { META_PAGE_ACCESS_TOKEN } = getEnv();

  const res = await fetch(`${GRAPH_API_BASE}/${commentId}/replies`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      access_token: META_PAGE_ACCESS_TOKEN,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(
      `Meta Graph API error replying to comment ${commentId}: ${res.status} ${body}`,
    );
  }
}
