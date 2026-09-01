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
// This app uses "Instagram API with Instagram Login". Real DM deliveries were
// confirmed (via raw payload logging) to use the classic Messenger Platform
// shape — entry[].messaging[] — e.g.:
//   {"object":"instagram","entry":[{"id":"...","time":...,
//     "messaging":[{"sender":{"id":"..."},"recipient":{"id":"..."},
//                   "timestamp":...,"message":{"mid":"...","text":"..."}}]}]}
// but Meta's own dashboard webhook "Test" button simulates a DM using the
// *other* documented shape instead — entry[].changes[] with
// field: "messages" — e.g.:
//   {"entry":[{"id":"0","time":...,"changes":[{"field":"messages",
//     "value":{"sender":{"id":"..."},"recipient":{"id":"..."},
//              "timestamp":"...","message":{"mid":"...","text":"..."}}}]}],
//    "object":"instagram"}
// So we accept both. Comments only ever showed up via entry[].changes[] with
// field: "comments".
// Full reference: https://developers.facebook.com/docs/instagram-platform/webhooks

type MetaMessagingEntry = {
  sender?: { id?: string };
  recipient?: { id?: string };
  timestamp?: number;
  message?: { mid?: string; text?: string; is_echo?: boolean };
};

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
  messaging?: MetaMessagingEntry[];
  changes?: MetaChange[];
};

export type MetaWebhookPayload = {
  object?: string;
  entry?: MetaEntry[];
};

function pushDm(
  events: ParsedMetaEvent[],
  message: { mid?: string; text?: string; is_echo?: boolean } | undefined,
  senderId: string | undefined,
): void {
  if (message?.is_echo) return;
  const mid = message?.mid;
  const text = message?.text;
  if (!mid || !senderId || !text) return;

  events.push({ source: "instagram_dm", externalId: mid, senderId, text });
}

/**
 * Flattens a raw Meta webhook payload into our normalized event list.
 * Skips echoes (messages the Page itself sent) and anything missing an id.
 */
export function parseMetaPayload(
  payload: MetaWebhookPayload,
): ParsedMetaEvent[] {
  const events: ParsedMetaEvent[] = [];

  for (const entry of payload.entry ?? []) {
    // Real DM deliveries: classic Messenger Platform shape.
    for (const messaging of entry.messaging ?? []) {
      pushDm(events, messaging.message, messaging.sender?.id);
    }

    for (const change of entry.changes ?? []) {
      if (change.field === "messages") {
        // Meta's dashboard "Test" button shape (not seen in real deliveries
        // yet, but documented — accept it defensively).
        const value = change.value as MetaMessageChangeValue;
        pushDm(events, value.message, value.sender?.id);
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
