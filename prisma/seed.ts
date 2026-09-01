import { PrismaClient } from "@prisma/client";
import { TEMPLATES } from "../src/data/templates";

const prisma = new PrismaClient();

async function main() {
  for (const t of TEMPLATES) {
    await prisma.template.upsert({
      where: { categoryId: t.categoryId },
      create: {
        categoryId: t.categoryId,
        tier: t.tier,
        section: t.section,
        question: t.question,
        textVariants: t.textVariants,
        hasPlaceholder: t.hasPlaceholder ?? false,
      },
      update: {
        tier: t.tier,
        section: t.section,
        question: t.question,
        textVariants: t.textVariants,
        hasPlaceholder: t.hasPlaceholder ?? false,
      },
    });
  }
  console.log(`[seed] upserted ${TEMPLATES.length} templates`);
}

main()
  .catch((err) => {
    console.error("[seed] failed", err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
