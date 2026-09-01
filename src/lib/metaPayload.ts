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
// This app uses "Instagram API with Instagram Login" (a standalone Instagram
// product), which delivers BOTH DMs and comments through the same
// entry[].changes[] array — distinguished only by `field` — unlike the
// classic Messenger Platform's separate entry[].messaging[] array. Verified
// against a live payload from Meta's own webhook "Test" button:
//   {"entry":[{"id":"0","time":...,"changes":[{"field":"messages",
//     "value":{"sender":{"id":"..."},"recipient":{"id":"..."},
//              "timestamp":"...","message":{"mid":"...","text":"..."}}}]}],
//    "object":"instagram"}
// Full reference: https://developers.facebook.com/docs/instagram-platform/webhooks

type MetaMessageChangeValue = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: string;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

type MetaCommentChangeValue = {
  id?: string; // comment id
  text?: string;
  from?: { id?: string; username?: string };
};

type MetaChange = {
  field?: string; // "messages" | "comments" | ...
  value?: MetaMessageChangeValue | MetaCommentChangeValue;
};

type MetaEntry = {
  id?: string;
  time?: number;
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
    for (const change of entry.changes ?? []) {
      if (change.field === "messages") {
        const value = change.value as MetaMessageChangeValue;
        if (value.message?.is_echo) continue;
        const mid = value.message?.mid;
        const senderId = value.sender?.id;
        const text = value.message?.text;
        if (!mid || !senderId || !text) continue;

        events.push({
          source: "instagram_dm",
          externalId: mid,
          senderId,
          text,
        });
      } else if (change.field === "comments") {
        const value = change.value as MetaCommentChangeValue;
        const commentId = value.id;
        const text = value.text;
        const senderId = value.from?.id;
        if (!commentId || !text || !senderId) continue;

        events.push({
          source: "instagram_comment",
          externalId: commentId,
          senderId,
          senderUsername: value.from?.username,
          text,
        });
      }
    }
  }

  return events;
}
