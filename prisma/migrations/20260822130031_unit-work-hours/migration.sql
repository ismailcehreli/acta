
CREATE TABLE "OrgUnitWorkCalendar" (
    "orgUnitId" TEXT NOT NULL,
    "workingDays" INTEGER[],
    "workStartMinute" INTEGER NOT NULL,
    "workEndMinute" INTEGER NOT NULL,
    "worksOnHolidays" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OrgUnitWorkCalendar_pkey" PRIMARY KEY ("orgUnitId")
);

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_orgUnitId_fkey"
  FOREIGN KEY ("orgUnitId") REFERENCES "OrgUnit"("id")
  ON DELETE RESTRICT ON UPDATE RESTRICT;

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_window"
  CHECK (
    "workStartMinute" >= 0
    AND "workEndMinute" <= 1440
    AND "workEndMinute" > "workStartMinute"
  );

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_days"
  CHECK (
    array_length("workingDays", 1) BETWEEN 1 AND 7
    AND "workingDays" <@ ARRAY[1,2,3,4,5,6,7]
  );
