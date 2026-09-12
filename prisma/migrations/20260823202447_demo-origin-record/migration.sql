
CREATE TABLE "DemoObject" (
    "objectType" VARCHAR(40) NOT NULL,
    "objectId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DemoObject_pkey" PRIMARY KEY ("objectType","objectId")
);
