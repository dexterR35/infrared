DO $migration$
BEGIN
 LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=16) THEN
  ALTER TABLE experiments DROP CONSTRAINT experiments_primary_metric_check,
    ADD CONSTRAINT experiments_primary_metric_check CHECK(primary_metric ~ '^(registration_completed|qualified_acquisition|purchase|loan_application|registration|add_to_cart|booking_completed|subscription|lead_generated|quote_requested|download_completed|trial_started|enrolment|appointment_booked|custom_conversion|custom[.][a-z][a-z0-9_]{0,55})$');
  ALTER TABLE acquisition_outcomes DROP CONSTRAINT acquisition_outcomes_kind_check,
    ADD CONSTRAINT acquisition_outcomes_kind_check CHECK(kind ~ '^(registration_completed|qualified_acquisition|purchase|loan_application|registration|add_to_cart|booking_completed|subscription|lead_generated|quote_requested|download_completed|trial_started|enrolment|appointment_booked|custom_conversion|custom[.][a-z][a-z0-9_]{0,55})$');
  INSERT INTO schema_migrations(version) VALUES(16);
 END IF;
END
$migration$;
