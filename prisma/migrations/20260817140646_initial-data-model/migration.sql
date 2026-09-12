CREATE TYPE "ActivityApprovalStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'CHANGES_REQUESTED', 'APPROVED', 'MANAGER_NOT_FOUND', 'CANCELLED');

CREATE TYPE "ConversationStatus" AS ENUM ('OPEN', 'CLOSED');

CREATE TYPE "ConversationCloseType" AS ENUM ('NORMAL', 'ADMINISTRATIVE');

CREATE TYPE "NotificationChannel" AS ENUM ('EMAIL', 'PUSH');

CREATE TYPE "NotificationStatus" AS ENUM ('PENDING', 'SENT', 'FAILED');

CREATE TABLE "OrgUnit" (
    "id" TEXT NOT NULL,
    "parentId" TEXT,
    "name" VARCHAR(150) NOT NULL,
    "type" VARCHAR(50) NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "requiresApproval" BOOLEAN NOT NULL DEFAULT false,
    "autoFlowsUp" BOOLEAN NOT NULL DEFAULT true,
    "attentionGroupId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgUnit_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "fullName" VARCHAR(150) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "orgUnitId" TEXT NOT NULL,
    "isUnitManager" BOOLEAN NOT NULL DEFAULT false,
    "isSystemAdmin" BOOLEAN NOT NULL DEFAULT false,
    "dailyDigestNotifications" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UserCredential" (
    "userId" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "passwordChangedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMPTZ(3),

    CONSTRAINT "UserCredential_pkey" PRIMARY KEY ("userId")
);

CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "revokedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Activity" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "authorOrgUnitId" TEXT NOT NULL,
    "activityDate" DATE NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "approvalStatus" "ActivityApprovalStatus" NOT NULL DEFAULT 'APPROVED',
    "currentRevisionNo" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Activity_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityRevision" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "revisionNo" INTEGER NOT NULL,
    "title" VARCHAR(150) NOT NULL,
    "description" VARCHAR(10000) NOT NULL,
    "targetOrgUnitIds" TEXT[],
    "changedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityRevision_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ActivityTargetDept" (
    "activityId" TEXT NOT NULL,
    "orgUnitId" TEXT NOT NULL,

    CONSTRAINT "ActivityTargetDept_pkey" PRIMARY KEY ("activityId","orgUnitId")
);

CREATE TABLE "Attachment" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "originalName" VARCHAR(255) NOT NULL,
    "storedName" VARCHAR(255) NOT NULL,
    "storagePath" VARCHAR(500) NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "mimeType" VARCHAR(150) NOT NULL,
    "sha256" CHAR(64) NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Attachment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CancellationRecord" (
    "activityId" TEXT NOT NULL,
    "cancelledById" TEXT NOT NULL,
    "reason" VARCHAR(1000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CancellationRecord_pkey" PRIMARY KEY ("activityId")
);

CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "activityId" TEXT NOT NULL,
    "askerId" TEXT NOT NULL,
    "responsibleId" TEXT NOT NULL,
    "status" "ConversationStatus" NOT NULL DEFAULT 'OPEN',
    "openedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMPTZ(3),
    "closeType" "ConversationCloseType",

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ConversationMessage" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "text" VARCHAR(10000) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConversationMessage_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ReadReceipt" (
    "activityId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstReadAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastReadAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ReadReceipt_pkey" PRIMARY KEY ("activityId","userId")
);

CREATE TABLE "WorkCalendar" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "workingDays" INTEGER[],
    "workStartMinute" INTEGER NOT NULL,
    "workEndMinute" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "WorkCalendar_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Holiday" (
    "date" DATE NOT NULL,
    "description" VARCHAR(150) NOT NULL,

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("date")
);

CREATE TABLE "NoActivityPeriod" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "note" VARCHAR(500),
    "deputyId" TEXT,
    "markedById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NoActivityPeriod_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationQueue" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "eventType" VARCHAR(100) NOT NULL,
    "channel" "NotificationChannel" NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" VARCHAR(255) NOT NULL,
    "status" "NotificationStatus" NOT NULL DEFAULT 'PENDING',
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastAttemptAt" TIMESTAMPTZ(3),
    "sentAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "NotificationQueue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "ScheduledJobStatus" (
    "jobName" VARCHAR(100) NOT NULL,
    "lastSuccessAt" TIMESTAMPTZ(3),
    "lastError" TEXT,
    "expectedIntervalMinutes" INTEGER NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ScheduledJobStatus_pkey" PRIMARY KEY ("jobName")
);

CREATE TABLE "SystemSetting" (
    "key" VARCHAR(100) NOT NULL,
    "value" VARCHAR(500) NOT NULL,
    "description" VARCHAR(500) NOT NULL,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "SystemSetting_pkey" PRIMARY KEY ("key")
);

CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "actualUserId" TEXT,
    "objectType" VARCHAR(100) NOT NULL,
    "objectId" VARCHAR(100) NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "detail" JSONB,
    "ipAddress" VARCHAR(45),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "OrgUnit_parentId_idx" ON "OrgUnit"("parentId");

CREATE INDEX "OrgUnit_isActive_idx" ON "OrgUnit"("isActive");

CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

CREATE INDEX "User_orgUnitId_idx" ON "User"("orgUnitId");

CREATE INDEX "User_isActive_idx" ON "User"("isActive");

CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

CREATE INDEX "Session_userId_revokedAt_idx" ON "Session"("userId", "revokedAt");

CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

CREATE INDEX "Activity_authorOrgUnitId_activityDate_idx" ON "Activity"("authorOrgUnitId", "activityDate");

CREATE INDEX "Activity_approvalStatus_activityDate_idx" ON "Activity"("approvalStatus", "activityDate");

CREATE INDEX "Activity_authorId_activityDate_idx" ON "Activity"("authorId", "activityDate");

CREATE INDEX "ActivityRevision_activityId_createdAt_idx" ON "ActivityRevision"("activityId", "createdAt");

CREATE UNIQUE INDEX "ActivityRevision_activityId_revisionNo_key" ON "ActivityRevision"("activityId", "revisionNo");

CREATE INDEX "ActivityTargetDept_orgUnitId_activityId_idx" ON "ActivityTargetDept"("orgUnitId", "activityId");

CREATE UNIQUE INDEX "Attachment_storedName_key" ON "Attachment"("storedName");

CREATE INDEX "Attachment_activityId_idx" ON "Attachment"("activityId");

CREATE INDEX "Attachment_sha256_idx" ON "Attachment"("sha256");

CREATE INDEX "CancellationRecord_cancelledById_idx" ON "CancellationRecord"("cancelledById");

CREATE INDEX "Conversation_responsibleId_status_idx" ON "Conversation"("responsibleId", "status");

CREATE INDEX "Conversation_askerId_status_idx" ON "Conversation"("askerId", "status");

CREATE INDEX "Conversation_activityId_status_idx" ON "Conversation"("activityId", "status");

CREATE INDEX "ConversationMessage_conversationId_createdAt_idx" ON "ConversationMessage"("conversationId", "createdAt");

CREATE INDEX "ReadReceipt_userId_lastReadAt_idx" ON "ReadReceipt"("userId", "lastReadAt");

CREATE INDEX "NoActivityPeriod_userId_startDate_endDate_idx" ON "NoActivityPeriod"("userId", "startDate", "endDate");

CREATE UNIQUE INDEX "NotificationQueue_idempotencyKey_key" ON "NotificationQueue"("idempotencyKey");

CREATE INDEX "NotificationQueue_status_lastAttemptAt_idx" ON "NotificationQueue"("status", "lastAttemptAt");

CREATE INDEX "NotificationQueue_userId_createdAt_idx" ON "NotificationQueue"("userId", "createdAt");

CREATE INDEX "AuditLog_objectType_objectId_createdAt_idx" ON "AuditLog"("objectType", "objectId", "createdAt");

CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

ALTER TABLE "OrgUnit" ADD CONSTRAINT "OrgUnit_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "User" ADD CONSTRAINT "User_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "UserCredential" ADD CONSTRAINT "UserCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Activity" ADD CONSTRAINT "Activity_authorOrgUnitId_fkey" FOREIGN KEY ("authorOrgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityRevision" ADD CONSTRAINT "ActivityRevision_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityRevision" ADD CONSTRAINT "ActivityRevision_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityTargetDept" ADD CONSTRAINT "ActivityTargetDept_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ActivityTargetDept" ADD CONSTRAINT "ActivityTargetDept_orgUnitId_fkey" FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Attachment" ADD CONSTRAINT "Attachment_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CancellationRecord" ADD CONSTRAINT "CancellationRecord_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "CancellationRecord" ADD CONSTRAINT "CancellationRecord_cancelledById_fkey" FOREIGN KEY ("cancelledById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_askerId_fkey" FOREIGN KEY ("askerId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_responsibleId_fkey" FOREIGN KEY ("responsibleId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ConversationMessage" ADD CONSTRAINT "ConversationMessage_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_activityId_fkey" FOREIGN KEY ("activityId") REFERENCES "Activity"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "ReadReceipt" ADD CONSTRAINT "ReadReceipt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NoActivityPeriod" ADD CONSTRAINT "NoActivityPeriod_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NoActivityPeriod" ADD CONSTRAINT "NoActivityPeriod_deputyId_fkey" FOREIGN KEY ("deputyId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NoActivityPeriod" ADD CONSTRAINT "NoActivityPeriod_markedById_fkey" FOREIGN KEY ("markedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "NotificationQueue" ADD CONSTRAINT "NotificationQueue_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actualUserId_fkey" FOREIGN KEY ("actualUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE RESTRICT;
