import { z } from "zod";

const envSchema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  META_APP_SECRET: z.string().min(1, "META_APP_SECRET is required"),
  META_VERIFY_TOKEN: z.string().min(1, "META_VERIFY_TOKEN is required"),
  META_PAGE_ACCESS_TOKEN: z
    .string()
    .min(1, "META_PAGE_ACCESS_TOKEN is required"),
  TELEGRAM_BOT_TOKEN: z.string().min(1, "TELEGRAM_BOT_TOKEN is required"),
  TELEGRAM_CHAT_ID: z.string().min(1, "TELEGRAM_CHAT_ID is required"),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | undefined;

/**
 * Validates and returns process.env against the required schema.
 * Throws with a readable message on boot / first use if anything is missing.
 */
export function getEnv(): Env {
  if (cachedEnv) return cachedEnv;

  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".")}: ${issue.message}`)
      .join("\n");
    throw new Error(`Invalid environment variables:\n${issues}`);
  }

  cachedEnv = parsed.data;
  return cachedEnv;
}
