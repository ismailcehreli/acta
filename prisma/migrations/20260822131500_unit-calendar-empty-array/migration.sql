
ALTER TABLE "OrgUnitWorkCalendar"
  DROP CONSTRAINT "OrgUnitWorkCalendar_valid_days";

ALTER TABLE "OrgUnitWorkCalendar"
  ADD CONSTRAINT "OrgUnitWorkCalendar_valid_days"
  CHECK (
    COALESCE(array_length("workingDays", 1), 0) BETWEEN 1 AND 7
    AND "workingDays" <@ ARRAY[1,2,3,4,5,6,7]
  );
