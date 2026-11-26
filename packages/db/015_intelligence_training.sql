CREATE TABLE IF NOT EXISTS intelligence_schedules (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 site_id text NOT NULL, page_key text NOT NULL,
 scope jsonb NOT NULL, scope_key text NOT NULL UNIQUE,
 requested_by text NOT NULL REFERENCES users(id),
 interval_hours integer NOT NULL CHECK(interval_hours IN (0,24,168)),
 lookback_days integer NOT NULL CHECK(lookback_days BETWEEN 1 AND 90),
 next_run_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(site_id,page_key) REFERENCES pages(site_id,page_key)
);
CREATE INDEX IF NOT EXISTS intelligence_schedules_due ON intelligence_schedules(next_run_at) WHERE interval_hours>0;
CREATE TABLE IF NOT EXISTS intelligence_runs (
 id text PRIMARY KEY, site_id text NOT NULL, page_key text NOT NULL,
 scope jsonb NOT NULL, scope_key text NOT NULL,
 model text NOT NULL CHECK(model IN ('sasrec','euler','conversion')),
 requested_by text NOT NULL REFERENCES users(id),
 dataset_from date NOT NULL, dataset_to date NOT NULL,
 status text NOT NULL DEFAULT 'queued' CHECK(status IN ('queued','running','completed','failed')),
 progress jsonb NOT NULL DEFAULT '[]', manifest jsonb, error_code text,
 created_at timestamptz NOT NULL DEFAULT now(), started_at timestamptz, finished_at timestamptz,
 FOREIGN KEY(site_id,page_key) REFERENCES pages(site_id,page_key)
);
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_run_pending ON intelligence_runs(scope_key,model) WHERE status IN ('queued','running');
-- One training process across API instances. The settings row serializes claims.
CREATE UNIQUE INDEX IF NOT EXISTS intelligence_one_worker ON intelligence_runs((1)) WHERE status='running';
CREATE INDEX IF NOT EXISTS intelligence_run_queue ON intelligence_runs(created_at,id) WHERE status='queued';
CREATE INDEX IF NOT EXISTS intelligence_run_history ON intelligence_runs(site_id,page_key,created_at DESC);
INSERT INTO settings(key,value) VALUES('intelligence_worker','{}') ON CONFLICT DO NOTHING;
INSERT INTO schema_migrations(version) VALUES(15) ON CONFLICT DO NOTHING;
