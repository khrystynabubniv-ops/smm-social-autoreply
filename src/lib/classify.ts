import OpenAI from "openai";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/prisma";
import { SECTION_GUIDANCE, TEMPLATES } from "@/data/templates";
import type { Template } from "@prisma/client";

const CONFIDENCE_THRESHOLD = 0.7;
const REPEAT_WINDOW_MS = 24 * 60 * 60 * 1000;

export type Tier = "A" | "B" | "C" | "escalate";

export type ClassificationResult = {
  categoryId: string | null;
  tier: Tier;
  confidence: number | null;
  proposedReply: string | null;
  template: Template | null;
};

const CATEGORY_LIST = TEMPLATES.map(
  (t) => `- ${t.categoryId} (${t.section}): ${t.question}`,
).join("\n");

const SECTION_NOTES = Object.entries(SECTION_GUIDANCE)
  .map(([section, note]) => `${section}: ${note}`)
  .join("\n");

const SYSTEM_PROMPT = `Ти — класифікатор вхідних Instagram-повідомлень і коментарів компанії Universe.

Твоя ЄДИНА задача — визначити, до якої категорії з FAQ належить повідомлення нижче. Ти НІКОЛИ не пишеш, не пропонуєш і не переформульовуєш текст відповіді — тільки класифікуєш. Текст відповіді завжди береться дослівно з бази шаблонів компанії окремим кроком, без участі LLM.

Категорії (id — розділ: приклад питання з FAQ):
${CATEGORY_LIST}

Контекст по деяких розділах:
${SECTION_NOTES}

Правила класифікації:
- Визнач НАЙБЛИЖЧУ категорію за змістом, включно з перефразованими або завуальованими варіантами того самого сенсу — орієнтуйся на зміст, а не на збіг ключових слів.
- Якщо жодна категорія не підходить впевнено — categoryId: null.
- Окремо визнач targetsIndividual: true, якщо повідомлення звинувачує, ображає чи критикує КОНКРЕТНУ людину (а не компанію в цілому чи загальну практику).
- confidence — число від 0 до 1: наскільки ти впевнена(-ий) у виборі категорії.
- НІКОЛИ не додавай текст відповіді, пояснення, коментарі чи будь-що поза форматом нижче.

Формат відповіді — СУВОРО JSON, без жодного тексту навколо:
{"categoryId": string | null, "confidence": number, "targetsIndividual": boolean}`;

type LlmClassification = {
  categoryId: string | null;
  confidence: number;
  targetsIndividual: boolean;
};

function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

function getLlmClient(): OpenAI {
  const { LITELLM_BASE_URL, LITELLM_API_KEY } = getEnv();
  return new OpenAI({
    baseURL: `${LITELLM_BASE_URL}/v1`,
    apiKey: LITELLM_API_KEY,
  });
}

function parseLlmResponse(raw: string): LlmClassification | null {
  try {
    const parsed = JSON.parse(raw) as Partial<LlmClassification>;
    if (
      typeof parsed.confidence !== "number" ||
      typeof parsed.targetsIndividual !== "boolean" ||
      (parsed.categoryId !== null && typeof parsed.categoryId !== "string")
    ) {
      return null;
    }
    return {
      categoryId: parsed.categoryId ?? null,
      confidence: parsed.confidence,
      targetsIndividual: parsed.targetsIndividual,
    };
  } catch {
    return null;
  }
}

async function callLlmClassifier(text: string): Promise<LlmClassification> {
  try {
    const client = getLlmClient();
    // Wrap in explicit delimiters so the model treats the message as data to
    // classify, never as instructions to follow — and cap length defensively.
    const userContent = `<message>${text.slice(0, 2000)}</message>`;

    const response = await client.chat.completions.create(
      {
        model: "claude-sonnet-4-6",
        temperature: 0,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: userContent },
        ],
      },
      {
        headers: {
          "x-litellm-tags":
            "service:smm-social-autoreply,feature:classification",
        },
      },
    );

    const raw = response.choices[0]?.message?.content ?? "";
    const parsed = parseLlmResponse(raw);
    if (!parsed) {
      console.error("[classify] LLM returned unparseable response:", raw);
      return { categoryId: null, confidence: 0, targetsIndividual: false };
    }
    return parsed;
  } catch (err) {
    console.error("[classify] LLM call failed", err);
    // Fail safe — route to a human rather than guessing.
    return { categoryId: null, confidence: 0, targetsIndividual: false };
  }
}

/**
 * "Not falling for it twice": if this same sender already got a Tier B/C
 * reply for the same category in the last 24h, don't auto-answer again —
 * escalate straight to a human instead of repeating a sensitive template.
 */
async function hasRecentSameCategoryReply(
  senderConversationKey: string,
  categoryId: string,
  excludeEventId: string,
): Promise<boolean> {
  const prior = await prisma.incomingEvent.findFirst({
    where: {
      senderConversationKey,
      categoryId,
      id: { not: excludeEventId },
      status: { not: "pending" },
      createdAt: { gte: new Date(Date.now() - REPEAT_WINDOW_MS) },
    },
  });
  return prior !== null;
}

export async function classifyMessage(event: {
  id: string;
  text: string;
  senderConversationKey: string | null;
}): Promise<ClassificationResult> {
  const llm = await callLlmClassifier(event.text);

  const template = llm.categoryId
    ? await prisma.template.findUnique({
        where: { categoryId: llm.categoryId },
      })
    : null;

  let tier: Tier;
  if (llm.targetsIndividual) {
    tier = "C";
  } else if (
    !llm.categoryId ||
    llm.confidence < CONFIDENCE_THRESHOLD ||
    !template
  ) {
    tier = "escalate";
  } else {
    tier = template.tier as Tier;
  }

  if (
    (tier === "B" || tier === "C") &&
    llm.categoryId &&
    event.senderConversationKey
  ) {
    const repeated = await hasRecentSameCategoryReply(
      event.senderConversationKey,
      llm.categoryId,
      event.id,
    );
    if (repeated) {
      tier = "escalate";
    }
  }

  let proposedReply: string | null = null;
  if ((tier === "A" || tier === "B") && template) {
    proposedReply = llm.categoryId?.startsWith("5.")
      ? pickRandom(template.textVariants)
      : template.textVariants[0];
  }

  return {
    categoryId: llm.categoryId,
    tier,
    confidence: llm.confidence,
    proposedReply,
    template,
  };
}
