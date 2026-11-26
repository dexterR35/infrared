# Predictive intelligence build history · 26 November 2026

The original project already supplied consent controls, heatmaps, page funnels, session signals, a randomized acquisition ledger, SASRec, EulerNet, and a versioned local training worker. This release extends those entry points. Its normal operating mode is a single local Node process with a private data directory. The optional research process runs on CPU.

## What shipped

| Area | Implementation and evidence |
| --- | --- |
| Cross-industry tracking | The tracker accepts the documented semantic types through `data-hm-type` on public elements and discovers images and videos. Existing manually assigned IDs take precedence. Use semantic wrappers for private forms. The SDK continues to exclude actual fields and their values from generic discovery. Existing host activation, exposure, hover, scroll, form, navigation, friction and engagement paths remain available. |
| Business outcomes | Migration 016 extends the backend event ledger and experiment goal to purchase, booking, loan application, signup, enrolment, and other business events. A custom goal uses `custom.<slug>`. Configure the page goal through the registry. Acquisition reports count distinct goal completers within each entry context. A backend-confirmed completion and a browser primary action can represent different stages. |
| Element intelligence | Dashboard comparison scores all supported first-exposure candidates in one Python invocation. CatBoost estimates 30-second click probability. A CatBoost ranker learns relative ordering when a view contains multiple elements with different labels. Its held-out NDCG@5 is compared with tied scores. |
| Conversion intelligence | A separate per-scope goal model uses the configured primary action. Bounded histories, observed exposure windows and chronological partitions prevent later clicks from entering features. The survival summary estimates time from entry to the first action, censoring at first hidden event or last observation. Departures may be informative, which limits interpretation. |
| Design and attention | Approved screenshots supply element placements, first-screen visibility and image edge density. New captures also include font size and local solid CSS color contrast where measurable. Saliency, local SigLIP or CLIP, OCR and sentence embeddings have a separate on-demand action. Observed attention reports count distinct qualified views. |
| Experiment intelligence | Fixed-horizon decisions retain their existing validity checks. The readout adds independent Beta(1,1) posterior comparison, a 95% credible interval and a fixed-seed simulation. Editors can analyse a valid closed randomized A/B experiment with SciPy Fisher exact inference and a cross-fitted EconML estimate adjusted for device. The research action also evaluates a page-level Thompson policy on held-out allocations. |
| Adaptive selection | Migration 017 adds an explicit adaptive experiment type. Assignment uses only the public site, page, experiment and campaign context. Each new UTC day learns from matured outcomes, begins with equal allocation when support is insufficient, and bounds each arm to 10–90%. The visit stores its original treatment probability. Repeat assignments are stable, recorded and generated evidence remain separate, and the adaptive readout is descriptive. |
| Journey and traffic | Observed branches and the existing Markov baseline accompany sequence ranking. HDBSCAN groups fully observed training views by exposure count and duration. Isolation Forest measures unusual held-out views. The traffic section reports aggregate counts and train-to-test distribution distances. These views exclude incomplete exposure windows. |
| Model management | Click and conversion jobs benchmark CatBoost, LightGBM and XGBoost alongside EulerNet, a logistic baseline and the observed rate. The CatBoost checkpoint includes native SHAP contributions and optional ranker weights. Manual CLI challengers include DeepFM and within-view DIN. Existing expiry, data-source separation, evidence revocation, schedules, versions and rollback apply. Recorded candidates that miss automatic publication checks are saved for editor review. |
| Local research and deployment | Dedicated Python 3.12 environment for EconML, Polars, SciPy, Optuna, local SQLite-backed MLflow, OCR and semantic models. Optional FastAPI keeps the research process warm. Redis can serialize research work across processes. Optional Docker Compose includes PostgreSQL and a separate research profile. |
| Performance | Exposure labeling indexes subsequent outcomes and observation gaps in a reverse pass. Peer comparisons reuse pooled counts. Dataset budgets, bounded view histories, limited CPU parallelism, sampled SHAP and clustering, and separate runtime limits bound work. |

## Run locally

Use Node 24 or newer and the existing Infrared native setup from the project README. From the project root on Windows:

```powershell
npm ci
py -3.13 -m venv .local/intelligence-venv
.local/intelligence-venv/Scripts/python -m pip install -r apps/intelligence/requirements.txt
py -3.12 -m venv .local/predictive-research
.local/predictive-research/Scripts/python -m pip install -r apps/intelligence/research/requirements.txt
.local/predictive-research/Scripts/python apps/intelligence/research/prepare_models.py
npm run build:archive
npm start
```

Open **Analysis → Predictive intelligence**, select a project, page, variant, source and UTC date window. Train the click model and, after choosing a registered primary action, the conversion model. Use **Compare elements** for a common first-exposure scenario. Explanations and comparisons use typical training context for unspecified channel, reach, load, elapsed time, element type and available design features. The training exporter joins approved screenshot placement, font size, CSS contrast and image density only when a matching reference existed by page entry at that exact viewport width. Feature contributions are in log-odds. Market, industry and banner styling are not inferred from a visitor profile.

The prepare-models command downloads two pinned public model snapshots (about 900 MB of weights). Subsequent analysis loads local files. Set `INFRARED_VISION_MODEL` to an alternative compatible local CLIP or SigLIP directory, or `INFRARED_COPY_MODEL` for a local Sentence Transformers directory. RapidOCR is the default OCR engine. Set `INFRARED_OCR=off` to disable OCR, or `1` to use an installed Tesseract binary. CSS color contrast only describes the foreground and solid background declarations on the measured element. Overlays and background imagery require inspection.

### Research commands

For an authorized click dataset exported using the dashboard:

```powershell
.local/intelligence-venv/Scripts/python apps/intelligence/eulernet.py train --dataset .local/click-examples.json --output-dir .local/experimental-run-001 --tabular --deepfm --din
.local/predictive-research/Scripts/python apps/intelligence/research/tune.py .local/click-examples.json --trials 8
```

Use a fresh experimental output directory per run. Optuna chooses settings on validation views and evaluates the chosen setting once on the chronological test partition. MLflow logs aggregate metrics and parameters under `.local/research-history/<scope hash>`. This explicit offline export is operator-managed. Delete the exported dataset and offline artifacts when the source expires or is withdrawn. Managed application models use the existing retention and invalidation checks.

On-demand research uses a bounded subprocess by default. For a persistent process, provision the same random `INFRARED_RESEARCH_TOKEN` of at least 32 characters in the API and research process environments and run `apps/intelligence/research/service.py` with the research interpreter. The service listens on loopback port 8765. Optional `INFRARED_RESEARCH_REDIS` configures a Redis URL for a short-lived CPU lease. The Redis key contains a random lease ID. Research requests pass through the application's site permissions.

For the optional container deployment, set a URL-safe `INFRARED_DB_PASSWORD` and run `docker compose -f infra/predictive/compose.yaml up --build`. For the persistent research server also set the shared research token and use `--profile research`. The native setup and the container setup have separate storage. The compose defaults expose dashboard and collector only on loopback. A real public deployment also needs the existing project's HTTPS, origin, consent, access and backup configuration.

### Build history

`npm run build:archive` creates a unique directory under `.local/build-history` with a ZIP, its SHA-256, and an internal manifest of file hashes. It includes the matching source, compiled dashboard, current SDK, migrations, and setup files. Credentials, databases, downloaded model weights and virtual environments stay outside the archive.

## Release assessment

Generated data can verify code paths and numerical identities. A model's utility requires representative recorded traffic from the specific site, an adequate number of independently observed outcomes and a future holdout. Relative ordering learned among already-exposed items does not identify the causal effect of moving those items. Screenshot saliency estimates visual structure. Qualified visibility measures the opportunity to see a region. Neither directly measures gaze. Financial and gambling use stays at the level of public design, usability and aggregate experiment performance.

Infrared uses its persisted job queue and scoped model registry for normal operation. The PyTorch sequence and deep interaction models remain experiments. Adaptive assignment uses the built-in two-arm policy. The research readout additionally benchmarks a Vowpal Wabbit epsilon-greedy policy on held-out randomized outcomes.

## Continuation · session 2 (26 November 2026)

A gap review against the original brief found five things missing or broken. Each one is fixed below, with how it was verified.

| Area | Change | Evidence |
| --- | --- | --- |
| Live model monitoring (brief phase 6: monitoring, drift detection) | New `eulernet.py monitor` command and `apps/intelligence/monitoring.py`. It scores only views that **began after the newest training view** (`newest_started_at`, now recorded in every manifest). It reports log loss against a constant predictor at the rate known at publication, a calibration z-score (observed minus predicted totals, divided by the binomial standard error), AUC against the held-out AUC, and the population stability index (PSI) per feature against a training reference profile stored in the manifest. Verdict precedence: retrain (no lift, \|z\| > 3, PSI ≥ 0.25, or more than 20% unseen elements) > watch (AUC drop > 0.05, PSI 0.10–0.25, or more than 5% unseen) > collect more data > healthy. Drift needs 200 or more fresh exposures before it can affect the verdict. Endpoint: `GET /api/intelligence/monitor?…&objective=click\|conversion`, rate-limited to 6 requests per 10 minutes, with the model ID rechecked before and after scoring. Dashboard: **Live model monitoring** card. | `apps/intelligence/test_monitoring.py` (6 tests: PSI identities, support gating, miscalibration, a real trained checkpoint scoring only post-cutoff views, shift and unseen-element detection, scope rejection). `tests/intelligence-training.test.ts` exercises the server path against a trained model. A browser step was added to `tests/e2e/intelligence.spec.ts`. |
| Industry profiles (any kind of website) | `packages/domain/industry-profiles.ts` maps the free-form registry `product` label (exact or by token, e.g. `fashion-store`, `hotels_ro`) to 12 profiles: financial, gaming, fashion, e-commerce, real estate, automotive, SaaS, healthcare, travel, media, education, corporate. Each profile has suggested goals, key element types and a `regulated` flag. The experiment goal picker groups recommended goals first and never removes a valid goal. The predictive panel shows the profile, with an aggregate-only notice for regulated sectors. | `tests/industry-profiles.test.ts` checks that every goal and element type is registered, aliases are unique, and ranking is lossless. |
| Uplift by segment (brief: uplift models) | The research experiment readout adds `device_effects`: a per-device difference in proportions with Newcombe hybrid-score intervals, Bonferroni-adjusted across reported devices. Devices with fewer than 30 units per arm are omitted. The UI labels this as exploratory and as a hypothesis, not a targeting rule. | `test_research.py`: known 25 pp effect recovered, interval covers it and excludes 0; thin segment omitted; the Wilson interval widens as z grows. |
| Heatmap device filter bug | Choosing a device (including the current one) reset an explicitly chosen viewport width to the default whenever the report's width list had not refreshed yet. The width is now kept whenever it belongs to the chosen device. | `tests/e2e/recording.spec.ts` (2545 px exact-width capture) |
| Stale browser expectations | These tests were written against an older UI and were updated to match the current one: the campaign table's expander column (7 headers); the exact *Element engagement* region; funnel steps rendered as metric cards; version cards inside `.version-grid`; reference cards marked with `data-reference-id`; the *Pages* nav and table names; *Project audit trail*; the 5/20/50 page sizes (chart data now checked on both pages); and the reference button label, which changes once an outline exists. Audit paging is now checked in the page and, for snapshot consistency, directly against the API, because the table client caches responses per URL. Test harness fix: the demo-project helper had replaced the bootstrap page list, hiding pages a test created. It now merges the lists and supports an explicit opt-out marker (`infrared.e2e.keep-project`). | `tests/e2e/studio.spec.ts`, `tests/e2e/recording.spec.ts`, `tests/e2e/environment.ts` |

Reviewed with no change needed: adaptive assignment (UTC is enforced for both PGlite and `pg` connections, outcomes are window-checked at ingestion, and the policy is frozen per UTC day under the experiment lock); the Beta-posterior sampler (Marsaglia–Tsang acceptance test is correct for shape ≥ 1); Kaplan–Meier landmarks (ties processed together, and each landmark is suppressed below the policy minimum).

Known limits: monitoring holds the single local inference slot for up to 60 s, so a concurrent prediction gets `INTELLIGENCE_BUSY` (429). Checkpoints trained before this session have no drift reference (`no_reference`); retrain them to enable drift checks. Industry profiles change defaults and wording only, never data collection or model features.

### Verification · session 2

| Check | Result |
| --- | --- |
| `npm run typecheck` | passes |
| `npm test` (Vitest, with the intelligence interpreter) | 43 files, 263 tests passed |
| `python -m unittest discover -s apps/intelligence` | 18 tests passed |
| `python -m unittest discover -s apps/intelligence/research` (research venv) | 5 tests passed |
| `npm run build` (OpenAPI regenerated, includes `/api/intelligence/monitor`) | passes |
| `npm run test:e2e` | 35 passed, 0 skipped, 0 failed |

## Session 3 · bundle split and correctness audit (26 November 2026)

**Bundle.** `npm run dev` warned that the main dashboard chunk was 505 kB (limit 500 kB). The portfolio filters moved to `growth-scope.tsx`. Markets, Acquisition, Experiments and Predictive intelligence now load on demand through `route-loader.tsx`, which has its own error boundary. Main chunk: 425 kB (132 kB gzip). Growth and intelligence are now separate 34 kB and 44 kB chunks.

**Audit scope.** Every file changed in sessions 1–2: acquisition and experiment assignment, the goal migration against the TypeBox schemas, tracker discovery against collector validation, capture contrast measurement, reference import, the exposure-window labelling reverse scan, the training publication gate, CatBoost context ordering in training and inference, the ranker feature layout, the research service authentication and lease, visual analysis input limits, dashboard null formatting, and the container files.

| Defect | Impact | Fix | Regression test |
| --- | --- | --- | --- |
| Monitoring treated exposures as independent, but one view usually contains several correlated exposures | The calibration z-score was overstated, producing false **Retrain** verdicts | The variance is the larger of the binomial and the view-clustered (sandwich) estimate | `test_correlated_exposures_widen_calibration_variance` |
| "No lift over baseline" compared point estimates only | Sampling noise in small fresh windows could trigger **Retrain** | A paired per-exposure log-loss difference with a view-clustered standard error. Retrain only when the model is worse by more than 2 SE. Otherwise a non-improving point estimate gives `LIFT_UNCERTAIN` (**Watch**) | `test_small_noisy_samples_do_not_trigger_retraining`, `test_reliably_worse_model_is_flagged` |
| The AUC drop threshold ignored AUC sampling error | False **Watch** alerts on small samples | The margin is max(0.05, 2 × Hanley–McNeil SE) | Same |
| An unestimable standard error could be infinite | `json.dumps(allow_nan=False)` would crash the monitor | Reported as `null` | `test_cluster_se_matches_the_ordinary_standard_error_for_singletons` |
| A busy warm research service (HTTP 429) was reported as 503 "unavailable" | Users saw an outage instead of "busy, retry" | Mapped to 429 `INTELLIGENCE_RESEARCH_BUSY` | `tests/local-research.test.ts` |

**Checked and correct:** A/B assignment is unchanged (the bucket is below 1 − p, with p = 0.5); the adaptive policy is per campaign and frozen per UTC day; goal values agree across the TypeBox schema, the DB check constraints and outcome counting; tracker auto-element kinds match the collector pattern; contrast is computed only for opaque solid colours; labels index clicks, conversions, hidden exits and observation gaps strictly after each exposure; publication keeps weak recorded candidates for review; the research token is compared in constant time and the Redis lease is released only by its owner; image pixel limits are checked before decoding.

### Verification · session 3

Typecheck passes · Vitest 44 files / 264 tests · Python 22 tests · research 5 tests · build passes with no chunk-size warning · browser suite 35 passed, 0 skipped, 0 failed.
