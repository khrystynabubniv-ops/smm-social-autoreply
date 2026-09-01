-- AlterTable
ALTER TABLE "IncomingEvent" DROP COLUMN "telegramMessageId",
ADD COLUMN     "telegramMessageIds" JSONB;
