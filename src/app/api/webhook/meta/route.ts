import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidMetaSignature } from "@/lib/metaSignature";
import { parseMetaPayload, type MetaWebhookPayload } from "@/lib/metaPayload";
import { proposeReply } from "@/lib/classify";
import { getInstagramUsername } from "@/lib/meta";
import { prisma } from "@/lib/prisma";
import { notifyTelegram } from "@/lib/notify";

// Meta's subscription verification handshake.
// https://developers.facebook.com/docs/graph-api/webhooks/getting-started#verification-requests
export async function GET(request: NextRequest) {
  const { META_VERIFY_TOKEN } = getEnv();
  const params = request.nextUrl.searchParams;

  const mode = params.get("hub.mode");
  const verifyToken = params.get("hub.verify_token");
  const challenge = params.get("hub.challenge");

  if (mode === "subscribe" && verifyToken === META_VERIFY_TOKEN && challenge) {
    return new NextResponse(challenge, { status: 200 });
  }

  return new NextResponse("Forbidden", { status: 403 });
}

export async function POST(request: NextRequest) {
  const rawBody = await request.text();
  const signature = request.headers.get("x-hub-signature-256");

  if (!isValidMetaSignature(rawBody, signature)) {
    return new NextResponse("Invalid signature", { status: 401 });
  }

  // Always ack 200 fast — Meta expects a response within ~20s and will retry
  // (potentially duplicating events) if we're slow or non-2xx.
  processPayload(rawBody).catch((err) => {
    console.error("[webhook:meta] failed to process payload", err);
  });

  return new NextResponse("EVENT_RECEIVED", { status: 200 });
}

async function processPayload(rawBody: string): Promise<void> {
  let payload: MetaWebhookPayload;
  try {
    payload = JSON.parse(rawBody);
  } catch {
    console.error("[webhook:meta] received non-JSON body, ignoring");
    return;
  }

  const rawEvents = parseMetaPayload(payload);

  if (rawEvents.length === 0) {
    // Nothing matched our parser's expected shape — log the raw payload so we
    // can see exactly what this Instagram product actually sends and fix the
    // parser, instead of silently dropping it.
    console.log("[webhook:meta] payload matched 0 events, raw body:", rawBody);
    return;
  }

  const { META_IG_ACCOUNT_ID } = getEnv();
  const events = rawEvents.filter((event) => {
    // Comments have no `is_echo` flag like DMs do — when we reply to a
    // comment, that reply is itself a new comment authored by our own
    // account, which fires another webhook event. Without this filter we'd
    // notify ourselves about our own replies forever.
    if (event.senderId === META_IG_ACCOUNT_ID) {
      console.log(
        `[webhook:meta] ignoring self-authored event: ${event.externalId}`,
      );
      return false;
    }
    return true;
  });

  for (const parsed of events) {
    try {
      // DM webhooks only give us the sender's numeric id, not their
      // username (comments already include it) — resolve it for display.
      const senderUsername =
        parsed.senderUsername ??
        (parsed.source === "instagram_dm"
          ? await getInstagramUsername(parsed.senderId)
          : undefined);

      const created = await prisma.incomingEvent.create({
        data: {
          source: parsed.source,
          externalId: parsed.externalId,
          senderId: parsed.senderId,
          senderUsername,
          text: parsed.text,
          proposedReply: proposeReply(parsed),
        },
      });

      await notifyTelegram(created);
    } catch (err: unknown) {
      // Unique constraint violation on externalId = duplicate delivery from Meta, ignore.
      if (isUniqueConstraintError(err)) {
        console.log(
          `[webhook:meta] duplicate event ignored: ${parsed.externalId}`,
        );
        continue;
      }
      console.error(
        `[webhook:meta] failed to handle event ${parsed.externalId}`,
        err,
      );
    }
  }
}

function isUniqueConstraintError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    "code" in err &&
    (err as { code?: string }).code === "P2002"
  );
}
