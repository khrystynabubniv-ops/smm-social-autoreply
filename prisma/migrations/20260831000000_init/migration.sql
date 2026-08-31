-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "IncomingEvent" (
    "id" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "senderId" TEXT NOT NULL,
    "senderUsername" TEXT,
    "text" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "proposedReply" TEXT,
    "finalReply" TEXT,
    "telegramMessageId" TEXT,
    "awaitingEditReply" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "IncomingEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "IncomingEvent_externalId_key" ON "IncomingEvent"("externalId");

-- CreateIndex
CREATE INDEX "IncomingEvent_status_idx" ON "IncomingEvent"("status");

-- CreateIndex
CREATE INDEX "IncomingEvent_awaitingEditReply_idx" ON "IncomingEvent"("awaitingEditReply");

