BEGIN;

ALTER TABLE workspace_profiles
  ADD COLUMN working_days smallint[] NOT NULL DEFAULT ARRAY[1,2,3,4,5]::smallint[],
  ADD COLUMN workday_start time NOT NULL DEFAULT '09:00',
  ADD COLUMN workday_end time NOT NULL DEFAULT '18:00';

ALTER TABLE workspace_profiles
  ADD CONSTRAINT workspace_profiles_working_days_check
  CHECK (
    cardinality(working_days) BETWEEN 1 AND 7
    AND working_days <@ ARRAY[0,1,2,3,4,5,6]::smallint[]
  ),
  ADD CONSTRAINT workspace_profiles_workday_range_check
  CHECK (workday_end > workday_start);

COMMIT;
