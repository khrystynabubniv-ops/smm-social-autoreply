/**
 * Normalized shape we store/notify on, regardless of whether the source
 * event was an Instagram DM or an Instagram comment.
 */
export type ParsedMetaEvent = {
  source: "instagram_dm" | "instagram_comment";
  externalId: string;
  senderId: string;
  senderUsername?: string;
  text: string;
};

// --- Minimal shapes for the parts of Meta's webhook payload we read. ---
// Full reference: https://developers.facebook.com/docs/messenger-platform/webhooks
// and https://developers.facebook.com/docs/instagram-platform/webhooks

type MetaMessagingEntry = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type MetaCommentChangeValue = {
  id?: string; // comment id
  text?: string;
  from?: { id?: string; username?: string };
};

type MetaChange = {
  field?: string;
  value?: MetaCommentChangeValue;
};

type MetaEntry = {
  id?: string;
  time?: number;
  messaging?: MetaMessagingEntry[];
  changes?: MetaChange[];
};

export type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

/**
 * Flattens a raw Meta webhook payload into our normalized event list.
 * Skips echoes (messages the Page itself sent) and anything missing an id.
 */
export function parseMetaPayload(
  payload: MetaWebhookPayload,
): ParsedMetaEvent[] {
  const events: ParsedMetaEvent[] = [];

  for (const entry of payload.entry ?? []) {
    for (const messaging of entry.messaging ?? []) {
      if (messaging.message?.is_echo) continue;
      const mid = messaging.message?.mid;
      const senderId = messaging.sender?.id;
      const text = messaging.message?.text;
      if (!mid || !senderId || !text) continue;

      events.push({
        source: "instagram_dm",
        externalId: mid,
        senderId,
        text,
      });
    }

    for (const change of entry.changes ?? []) {
      if (change.field !== "comments") continue;
      const commentId = change.value?.id;
      const text = change.value?.text;
      const senderId = change.value?.from?.id;
      if (!commentId || !text || !senderId) continue;

      events.push({
        source: "instagram_comment",
        externalId: commentId,
        senderId,
        senderUsername: change.value?.from?.username,
        text,
      });
    }
  }

  return events;
}
