import { NextRequest, NextResponse } from "next/server";
import { getEnv } from "@/lib/env";
import { isValidMetaSignature } from "@/lib/metaSignature";
import { parseMetaPayload, type MetaWebhookPayload } from "@/lib/metaPayload";
import { proposeReply } from "@/lib/classify";
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

  const events = parseMetaPayload(payload);

  for (const parsed of events) {
    try {
      const created = await prisma.incomingEvent.create({
        data: {
          source: parsed.source,
          externalId: parsed.externalId,
          senderId: parsed.senderId,
          senderUsername: parsed.senderUsername,
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
