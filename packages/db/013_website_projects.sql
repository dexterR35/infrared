-- Website projects replace the built-in sample workspace. Keep historical data intact.
ALTER TABLE sites ADD COLUMN IF NOT EXISTS archived boolean NOT NULL DEFAULT false;
ALTER TABLE sites ADD COLUMN IF NOT EXISTS auto_discovery boolean NOT NULL DEFAULT false;
ALTER TABLE pages ALTER COLUMN product SET DEFAULT 'website';
ALTER TABLE pages ALTER COLUMN primary_cta_id SET DEFAULT '';
ALTER TABLE pages ALTER COLUMN primary_action_id SET DEFAULT '';
UPDATE sites SET archived=true,enabled=false WHERE environment='synthetic'
 AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=13);
UPDATE sites SET auto_discovery=true WHERE environment='real'
 AND NOT EXISTS (SELECT 1 FROM schema_migrations WHERE version=13);
UPDATE pages SET primary_cta_id='' WHERE primary_cta_id='hero-register' AND NOT elements ? 'hero-register';
UPDATE pages SET primary_action_id='' WHERE primary_action_id='registration-start' AND NOT actions ? 'registration-start';
INSERT INTO schema_migrations(version) VALUES(13) ON CONFLICT DO NOTHING;
