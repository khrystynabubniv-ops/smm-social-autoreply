import { createHmac, timingSafeEqual } from "node:crypto";
import { getEnv } from "@/lib/env";

/**
 * Verifies the `X-Hub-Signature-256` header Meta sends with every webhook POST.
 * Must be run against the raw request body bytes (not a re-serialized JSON.stringify),
 * since any formatting difference invalidates the HMAC.
 */
export function isValidMetaSignature(
  rawBody: string,
  signatureHeader: string | null,
): boolean {
  if (!signatureHeader) return false;

  const [algo, providedHex] = signatureHeader.split("=");
  if (algo !== "sha256" || !providedHex) return false;

  const { META_APP_SECRET } = getEnv();
  const expectedHex = createHmac("sha256", META_APP_SECRET)
    .update(rawBody, "utf8")
    .digest("hex");

  const provided = Buffer.from(providedHex, "hex");
  const expected = Buffer.from(expectedHex, "hex");

  if (provided.length !== expected.length) return false;
  return timingSafeEqual(provided, expected);
}
