-- AlterTable
ALTER TABLE "Session" ADD COLUMN     "credentialVersion" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "UserCredential" ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 0;
