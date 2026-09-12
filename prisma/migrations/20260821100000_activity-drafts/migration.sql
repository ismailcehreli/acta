
CREATE TABLE "ActivityDraft" (
  "id"               TEXT NOT NULL,
  "authorId"         TEXT NOT NULL,
  "activityDate"     DATE NOT NULL,
  "title"            VARCHAR(150) NOT NULL,
  "description"      VARCHAR(10000) NOT NULL,
  "targetOrgUnitIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "openFollowUp"     BOOLEAN NOT NULL DEFAULT false,
  "savedManually"    BOOLEAN NOT NULL DEFAULT false,
  "createdAt"        TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
  "updatedAt"        TIMESTAMPTZ(3) NOT NULL,

  CONSTRAINT "ActivityDraft_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ActivityDraft_authorId_fkey"
    FOREIGN KEY ("authorId") REFERENCES "User"("id")
    ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX "ActivityDraft_authorId_updatedAt_idx"
  ON "ActivityDraft" ("authorId", "updatedAt" DESC);

CREATE OR REPLACE FUNCTION limit_activity_drafts() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
DECLARE
  adet INTEGER;
BEGIN
  SELECT count(*) INTO adet FROM "ActivityDraft" WHERE "authorId" = NEW."authorId";

  IF adet > 50 THEN
    RAISE EXCEPTION
      'TOO_MANY_DRAFTS: a user can keep at most 50 drafts';
  END IF;

  RETURN NULL;
END;
$$;

CREATE CONSTRAINT TRIGGER "ActivityDraft_limit"
  AFTER INSERT ON "ActivityDraft"
  DEFERRABLE INITIALLY IMMEDIATE
  FOR EACH ROW EXECUTE FUNCTION limit_activity_drafts();
