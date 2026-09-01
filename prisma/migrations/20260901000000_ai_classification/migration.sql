-- AlterTable
ALTER TABLE "IncomingEvent" ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "confidence" DOUBLE PRECISION,
ADD COLUMN     "senderConversationKey" TEXT,
ADD COLUMN     "tier" TEXT;

-- CreateTable
CREATE TABLE "Template" (
    "id" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "textVariants" TEXT[],
    "hasPlaceholder" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "Template_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Template_categoryId_key" ON "Template"("categoryId");

-- CreateIndex
CREATE INDEX "IncomingEvent_senderConversationKey_idx" ON "IncomingEvent"("senderConversationKey");

