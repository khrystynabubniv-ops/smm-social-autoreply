import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

type CheckResult = { ok: boolean; error?: string };

async function checkApp(): Promise<CheckResult> {
  return { ok: true };
}

async function checkDatabase(): Promise<CheckResult> {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return { ok: true };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "unknown error",
    };
  }
}

const checks: Record<string, () => Promise<CheckResult>> = {
  app: checkApp,
  database: checkDatabase,
};

export async function GET() {
  const entries = await Promise.all(
    Object.entries(checks).map(
      async ([name, run]) => [name, await run()] as const,
    ),
  );

  const results = Object.fromEntries(entries);
  const healthy = entries.every(([, result]) => result.ok);

  return NextResponse.json(
    { status: healthy ? "ok" : "error", checks: results },
    {
      status: healthy ? 200 : 503,
    },
  );
}
