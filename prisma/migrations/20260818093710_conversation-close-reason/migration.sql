ALTER TYPE "ConversationCloseType" ADD VALUE 'CANCELLED_ACTIVITY';

ALTER TABLE "Conversation" ADD COLUMN     "closeReason" VARCHAR(500);
