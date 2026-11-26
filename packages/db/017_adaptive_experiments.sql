DO $migration$
BEGIN
 LOCK TABLE schema_migrations IN SHARE ROW EXCLUSIVE MODE;
 IF NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=17) THEN
  ALTER TABLE experiments DROP CONSTRAINT experiments_kind_check,
    ADD CONSTRAINT experiments_kind_check CHECK(kind IN ('aa','ab','adaptive'));
  ALTER TABLE acquisition_visits ADD COLUMN treatment_probability double precision CHECK(treatment_probability BETWEEN 0.1 AND 0.9),
    ADD COLUMN assignment_evidence_version text;
  CREATE INDEX adaptive_visit_policy ON acquisition_visits(experiment_id,data_source,campaign,created_at DESC)
    WHERE treatment_probability IS NOT NULL;
  INSERT INTO schema_migrations(version) VALUES(17);
 END IF;
END
$migration$;
