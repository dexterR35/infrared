-- Rotated on evidence withdrawal so old exports/checkpoints cannot be served again.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS intelligence_version text NOT NULL DEFAULT 'initial';
INSERT INTO schema_migrations(version) VALUES(12) ON CONFLICT DO NOTHING;
