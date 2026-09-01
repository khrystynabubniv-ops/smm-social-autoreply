import { getEnv } from "@/lib/env";
import type { IncomingEvent } from "@prisma/client";

// This app uses "Instagram API with Instagram Login" (a standalone Instagram
// product, no Facebook Page in the middle) — tokens are IGAA-prefixed
// Instagram User Access Tokens, and calls go through graph.instagram.com,
// NOT graph.facebook.com (which is for the classic Page-linked Instagram
// Graph API and rejects these tokens).
const GRAPH_API_BASE = "https://graph.instagram.com/v21.0";

/**
 * Sends the final reply back to Meta.
 *
 * - instagram_comment: real call to the Graph API `/{comment-id}/replies` endpoint,
 *   since `instagram_business_manage_comments` is already an approved permission.
 * - instagram_dm: stub only (console.log) until `instagram_business_manage_messages`
 *   is approved for this app — replace the branch body with a real
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

/**
 * Resolves an Instagram username from the numeric IGSID (Instagram-scoped
 * user id) Meta gives us in DM webhook payloads. Unlike comments, DM
 * webhooks don't include the sender's username directly — only their id —
 * so we look it up separately for display in Telegram. Best-effort: returns
 * undefined (falling back to showing the raw id) if the lookup fails.
 */
export async function getInstagramUsername(
  igsid: string,
): Promise<string | undefined> {
  const { META_PAGE_ACCESS_TOKEN } = getEnv();

  try {
    const res = await fetch(
      `${GRAPH_API_BASE}/${igsid}?fields=username&access_token=${META_PAGE_ACCESS_TOKEN}`,
    );
    if (!res.ok) {
      console.warn(
        `[meta] failed to resolve username for ${igsid}: ${res.status} ${await res.text()}`,
      );
      return undefined;
    }
    const data = (await res.json()) as { username?: string };
    return data.username;
  } catch (err) {
    console.warn(`[meta] failed to resolve username for ${igsid}`, err);
    return undefined;
  }
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
