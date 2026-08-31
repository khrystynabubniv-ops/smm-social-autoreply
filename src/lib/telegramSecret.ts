import { timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header Telegram sends with every
 * webhook POST once a secret_token is registered via `setWebhook`. Telegram has no
 * HMAC-over-body mechanism (unlike Meta) — this shared secret is the only way to
 * confirm a request actually came from Telegram and not a random caller who found
 * the webhook URL.
 */
export function isValidTelegramSecret(headerValue: string | null): boolean {
  const { TELEGRAM_WEBHOOK_SECRET } = getEnv();
  if (!headerValue) return false;

  const provided = Buffer.from(headerValue, "utf8");
  const expected = Buffer.from(TELEGRAM_WEBHOOK_SECRET, "utf8");

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
