import type { ParsedMetaEvent } from "@/lib/metaPayload";

/**
 * Stub for the future AI classification step (OpenRouter, etc.).
 * For now every event gets the same placeholder so the end-to-end flow
 * (webhook → Telegram → confirm/edit → send) can be tested and screencast
 * for Meta App Review before real classification is wired up.
 */
export function proposeReply(_event: ParsedMetaEvent): string {
  return "[тут буде пропонована відповідь]";
}
