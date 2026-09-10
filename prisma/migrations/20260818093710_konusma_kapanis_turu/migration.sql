-- AlterEnum
ALTER TYPE "ConversationCloseType" ADD VALUE 'CANCELLED_ACTIVITY';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "closeReason" VARCHAR(500);
