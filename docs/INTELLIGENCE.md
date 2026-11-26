# Local SASRec and EulerNet intelligence

See the [predictive intelligence build record](PREDICTIVE-BUILD-2026-11-26.md) for model comparisons, semantic tracking, optional local runtimes, adaptive experiments and release instructions.


Infrared trains SASRec on registered interactions within a single consented page view and ranks the next interaction from a supplied history. EulerNet supports separate click and primary-action conversion objectives over a defined observed window. Open **Analysis → Predictive intelligence** to train models directly from the database, schedule retraining, inspect progress and evaluations, explore journeys, and restore a saved version. Ordinary analytics does not require Python or trained models.

## Automatic training

After the optional runtime is installed once, select a page, activity source, variant and UTC activity dates, then choose **Train models**. Individual SASRec, click and conversion training buttons are also available. Datasets are generated internally from retained, scoped evidence and removed on success or failure. There is no need to download JSON or run Python commands for each training run. The app automatically detects `.local/intelligence-venv` unless `INFRARED_INTELLIGENCE_PYTHON` is explicitly set.

Jobs and daily/weekly schedules are persisted in the database (migration 015). A database lock and unique running-job index serialize CPU training across API instances; replicas must share the same private model storage. The management/API process runs the scheduler every five seconds. A stopped server performs one missed run when restarted, without replaying every missed interval. Daily and weekly intervals are measured from when the schedule is saved. Scheduled windows roll over the selected number of UTC calendar dates and are clipped to raw retention. A changed page revision or revoked author permission disables its schedule. Scheduling stays off until an owner or administrator enables it for a scope. Automatic publication switches a single `active.json` pointer atomically to an immutable version; legacy manually installed pairs remain supported until the first managed publication.

The dashboard polls job state and charts epoch training loss and, for EulerNet, validation loss. SASRec also records validation NDCG. Each objective fails independently with a visible error when runtime, observation or support requirements are unmet; the previously active model stays installed. Training is bounded to 30 minutes; abandoned claims expire after 35 minutes. Pending jobs survive restart; interrupted jobs fail rather than being silently retried. The server cleans abandoned temporary datasets after their lease expires. Successful jobs save immutable artifacts under `intelligence/<scope-hash>/versions/<run-id>/`, validate against the current page/evidence/privacy policy, and publish the active pair. **Use this model version** restores an eligible version after repeating those checks. Expired or revoked versions cannot be restored. Retention removes managed version artifacts too. Logical backups retain schedules and job history, exclude weights, and mark restored runs as requiring retraining.

Owners and administrators can train, schedule and restore versions with site membership, same-origin/CSRF controls, rate limits, and audited changes. Reporting roles can inspect runs, evaluation, the journey map and experiment comparisons. Installer access is denied.

## Conversion, journeys and element reviews

Conversion is a separate EulerNet checkpoint with target `qualified_exposure_primary_action_30s`: among eligible first exposures **before** the configured primary action has occurred, estimate whether that registered activation occurs in the following 30 seconds. Configure `primary_action_id` in the page policy. This is an observed activation goal, not a backend-verified registration or qualified acquisition. It requires the same fully observed windows, chronological partitions, minimum positive/negative cohorts, validation-only calibration and held-out baseline comparisons as the click model. Exposure-time features exclude later activity. Changing the primary action invalidates the conversion checkpoint. Click and conversion objectives have separate hashes, evaluations and probability outputs.

The interactive journey map counts distinct views for each observed action and adjacent-action edge, suppresses small cohorts, and lets you follow branches. It is scoped to one page view, not a persistent user profile. Element reviews use fully observed exposure/click outcomes. An exploratory flag means an element's 95% Wilson click-rate interval is below the pooled interval of other reportable elements. Small real-site outcome cohorts are excluded from both displayed rows and peer comparisons. Different placements, overlapping views, and multiple comparisons limit interpretation: these flags suggest investigation and do not prove a defect or causal impact. The A/B comparison uses the existing randomized experiment readout and retains its maturity, validity and suppression checks; select each analysis variant separately when training.

New endpoints:

- `GET /api/intelligence/training`: scope query; recent runs, schedules, registered experiment variants and primary action.
- `POST /api/intelligence/train`: scope, `from`, `to`, and `models` (`sasrec`, `euler`, `conversion`); returns HTTP 202 with run IDs.
- `POST /api/intelligence/training/schedule`: scope, `interval_hours` (0/off, 24/daily, 168/weekly), `lookback_days` (1–90).
- `POST /api/intelligence/training/rollback`: scope and `run_id`; restores a compatible, unexpired artifact.
- `GET /api/intelligence/journey`: scope and dates; aggregate graph and exploratory element comparisons, without view identifiers.
- `GET /api/intelligence/conversion/status` and `POST /api/intelligence/conversion/predict`: separate conversion status/evaluation and exposure-history inference, using the EulerNet prediction input contract.

These are direct PyTorch implementations: SASRec uses causal self-attention, item/position embeddings and next-item cross-entropy; EulerNet uses complex polar feature interactions with learned real-valued orders and implicit real/imaginary feed-forward paths. The EulerNet implementation is independently written from the published architecture, with stability clamps, layer normalization and an Infrared-specific feature/label contract. It does not vendor upstream code or claim exact reproduction of paper benchmarks. RecBole is an alternative training framework, rather than a prerequisite; it is not installed by this integration. See the [SASRec paper](https://arxiv.org/abs/1808.09781), [EulerNet paper by Tian et al.](https://arxiv.org/abs/2304.10711), [RecBole's EulerNet reference](https://www.recbole.io/docs/user_guide/model/context/eulernet.html), and [PyTorch attention API](https://docs.pytorch.org/docs/stable/generated/torch.nn.MultiheadAttention.html).

## Install the optional runtime

Use Python 3.12 or later with a supported PyTorch wheel. The integration was exercised locally with Python 3.13 and CPU PyTorch 2.15.0. From the repository root on Windows:

```powershell
python -m venv .local/intelligence-venv
.local/intelligence-venv/Scripts/python.exe -m pip install torch==2.15.0 --index-url https://download.pytorch.org/whl/cpu
.local/intelligence-venv/Scripts/python.exe -m pip install -r apps/intelligence/requirements.txt
```

Set the interpreter in `.env`, then restart the Infrared server:

```dotenv
INFRARED_INTELLIGENCE_PYTHON=.local/intelligence-venv/Scripts/python.exe
```

On macOS/Linux use `.local/intelligence-venv/bin/python`. Without an explicit setting, Infrared detects that virtual environment and falls back to `python` when absent. Python is launched locally with bounded processes; inference uses stdin and has no public port or external inference API. Existing installations receive the evidence-version and training migrations during normal startup.

Python/PyTorch must be installed separately. Both models are optional native workstation integrations. A deployed API needs a supported Python runtime, these requirements, the scripts under `apps/intelligence/`, and its private model directory. The current process-per-request design is a private analysis path, not a high-throughput public prediction tier.

## Advanced manual export and training

1. Sign in as an owner or administrator. In Predictive intelligence, select a page, **Recorded activity** or **Generated samples**, and export dates (inclusive UTC calendar dates).
2. Choose **Download training sequences**. This creates a private JSON dataset containing registered action tokens and sequence start/end timestamps. It excludes view IDs, session IDs, unit identifiers, URLs, form contents, coordinates, and demographic/source attributes. Each sequence belongs to one page view. The export is audited and rate limited.
3. Train from the repository root, using the interpreter installed above:

   ```powershell
   .local/intelligence-venv/Scripts/python.exe apps/intelligence/sasrec.py train --dataset C:/path/to/infrared-sequences.json
   ```

   If the running app uses a custom `DATA_DIR` from `.env`, pass the same absolute directory to Python with `--data-dir C:/path/to/data`. The Python CLI reads the shell's `DATA_DIR`; it does not read `.env`. Training options are `--epochs` (default 20), `--max-length` (default 50), `--hidden` (default 64, even), and `--seed` (default 2026). CPU training is intentional for this first local implementation.

4. Delete the downloaded dataset after training. In the dashboard choose **Refresh data**, build the observed history, and choose **Predict next action**. A model for another page, revision, variant, locale, presentation state, registry, data source, or evidence version cannot serve that request. The screen uses the current page revision and lets you choose its default or a registered experiment variant.

The authenticated CLI can also download a dataset while the app is running:

```sh
pnpm intelligence:export --site local-demo --page casino-halloween --revision demo-v1 --variant control --source seeded --from 2026-11-01 --to 2026-11-25 --output .local/intelligence-dataset.json
```

Change the dates to match retained activity. The CLI uses the existing local administrator credentials helper or `ADMIN_EMAIL` and `ADMIN_PASSWORD`. It accesses the management API and never opens the running PGlite database. A date window may span at most 90 days and is clipped to current raw retention. Requests over the 100,000 relevant-event budget fail rather than silently sampling/truncating views. Unclassified legacy data cannot train models.

## Sequence contract

Supported action tokens are:

| Token | Source |
| --- | --- |
| `page_view` | Confirmed start of a page view; an input marker, excluded from next-action candidates |
| `exposure:<element_id>` | First qualified exposure of a registered element |
| `click:<element_id>` | Pointer click with a registered target |
| `activation:<action_id>` | Registered activation, including keyboard and host activations |

Events are ordered by SDK `seq`, regardless of arrival order. Backwards timestamps, duplicate relevant sequence positions, or repeated page-view markers exclude an ambiguous view. Unknown targets and other event types are excluded. Repeated clicks are preserved. There are no inferred terminal/abandonment events. Timing orders the observations; the model itself uses action positions, not elapsed time. Date/device/campaign filters elsewhere in the dashboard do not apply to this screen; it explicitly shows all devices and campaign codes for its scoped page configuration.

Cross-page predictive funnels and behaviour clustering require different data contracts and remain outside these models. No persistent visitor profile is created, and the existing opt-in cross-page journey setting is unchanged.

## Evaluation and minimum data

At least 10 eligible page-view sequences are needed. The trainer sorts complete views chronologically into approximately 70% train, 15% validation and 15% test. Views ending at or after the next partition starts are purged from the earlier partition. This keeps a single view out of multiple partitions and prevents overlapping view outcomes from leaking across time boundaries.

Only training views build the vocabulary and popularity/last-action baselines. An action must appear in at least the configured minimum number of distinct training views for real sites (one for synthetic sites). Sequences with unsupported actions are excluded from optimization rather than spliced into invented transitions. Validation chooses the checkpoint by NDCG; the final held-out test is evaluated once. Every held-out view predicts its final action from its preceding prefix. Unsupported histories or targets count as misses for all models and are reported as `unknown_targets` (the count includes unsupported histories).

The held-out test cohort must also meet the real site's minimum cohort. With the default 20-view threshold, expect to need roughly 134 or more non-overlapping views, plus enough training support for every retained action; 10 views is only the synthetic minimum. Increasing the privacy threshold can invalidate an older model until it is retrained.

The dashboard reports Hit Rate@K and NDCG@K for SASRec, a last-action transition baseline, and a popularity baseline using the same full candidate set. K is the smaller of five and the number of available next actions. When K covers most or all actions, Hit Rate@K will be easy to saturate; use NDCG and a larger real cohort to judge ordering. No uplift or superior accuracy is promised. Generated samples validate plumbing only. Real deployment needs out-of-time real data and review against simpler baselines; rankings do not establish causal conversion lift.

Scores are raw ranking logits, **not calibrated click probabilities**. All known next-action candidates, including already observed actions, remain eligible. The current inference path starts a CPU process per request, serializes inference within a Node process, times out after 15 seconds, and limits each user to 10 predictions per minute. It suits private exploratory analysis, not a high-throughput serving tier.

## Artifacts, deletion and recovery

Training writes `model.pt` and `manifest.json` under `DATA_DIR/intelligence/<scope-hash>/`. SASRec keeps its original site/page/source/revision/variant hash; EulerNet includes its model name in the hash so installing one cannot overwrite the other. The manifest records the complete scope, vocabulary, minimum support, split/training details, held-out metrics, timestamps and a unique model ID. Weights load with PyTorch's `weights_only=True`. Each file is replaced atomically; model IDs prevent a mixed pair from serving during publication. Run one training job per model/scope at a time. Protect this directory as application data; install only locally trained/trusted checkpoints.

Model expiry is the oldest exported view's start plus the raw retention duration at export. Serving also checks the current retention duration, so shortening retention takes effect immediately. Retention maintenance deletes expired and revoked managed model files. Downloaded/copied datasets and externally copied checkpoints are outside managed storage; their custodians must delete them and apply withdrawal/retention policies as well. Only the two managed artifact filenames are pruned.

Acquisition consent withdrawal rotates a site evidence version in the same database transaction that deletes linked raw evidence. All earlier site models and exports become incompatible, including a checkpoint retrained later from an old export. Retention subsequently removes revoked installed artifacts. A new export/retrain is required. Inference rechecks model status after Python returns to discard a result invalidated while it was running. Ordinary SDK consent denial continues to stop collection as before; the model does not add a new visitor deletion or identification mechanism.

Standard logical backups retain the database evidence version, training runs and schedules but do not include Python environments, temporary dataset exports or model files. Restored runs are marked as requiring retraining. Model artifacts are disposable derivatives; do not restore an old checkpoint independently over a newer database with withdrawals.

## API and verification

- `GET /api/intelligence/dataset`: owner/administrator export with site membership, strict scope and date query, no-store and audit.
- `GET /api/intelligence/status`: reporting roles with site membership; returns `not_trained`, `expired`, `incompatible`, or `ready` with a manifest.
- `POST /api/intelligence/predict`: reporting roles with site membership, same-origin/CSRF and rate limits. Body: the scope plus `history` (1–50 known tokens) and `top_k` (1–10).

Scope fields are `site_id`, `page_key`, `data_source` (`recorded` or `seeded`), `revision`, `variant`. Dataset requests additionally require `from` and `to`.

## EulerNet labels, training and joint analysis

EulerNet answers a precise target: **among first qualified exposures with a complete observed 30-second window, will this registered element receive a pointer click within that window?** It does not estimate the click rate over all visitors, including early departures. Keyboard/host activations remain separate SASRec events and are not silently treated as pointer clicks.

The exporter requires a confirmed page view, contiguous SDK sequence numbers, nondecreasing event times, no reported dropped events, and observation extending past the exposure deadline. There must be no gap longer than 15 seconds between observations through that deadline; the existing SDK emits progress periodically. A hidden-window signal within the horizon also excludes the exposure. These rules apply equally to clicked and unclicked examples. Leaving early, a missing/delayed event, or an incomplete window is **censoring**, not a negative label. The original short-duration synthetic traffic may therefore have no eligible EulerNet examples; do not weaken the rules to force a model to train. Capture longer consented views or use the isolated model-test fixtures.

Exported rows contain six categorical features available at exposure time: registered `element_id`, viewport-derived `device`, `previous_action`, and buckets for recent clicks, activations and prefix length. Only the preceding 49 registered actions are considered. No later click, reach, dwell, conversion, demographic data, persistent identity, coordinates or full URLs enter features. The current exposure is the last history token and is removed before feature calculation. A view contributes at most one example per registered element.

To train EulerNet:

1. Choose a page, source and export dates, then **Download click training examples**. The server exports a separate `infrared-click-examples.json`, audits the export and preserves source/configuration/evidence scope.
2. Run:

   ```powershell
   .local/intelligence-venv/Scripts/python.exe apps/intelligence/eulernet.py train --dataset C:/path/to/infrared-click-examples.json
   ```

   Use `--data-dir` if the app uses a custom data directory. Optional parameters are `--epochs` (default 30), `--width` (default 8), and `--seed` (default 2026).
3. Delete the export. Refresh the dashboard. Build an observed history ending in the element's first `exposure:<element_id>`, choose **Device at exposure**, and select **Estimate exposed-element click**. When a compatible SASRec model is also installed, **Analyze both models** displays the ranking and click estimate together. The device must match the current exposure; results for unseen/sparse context values explicitly report the unknown-context fallback.

Both datasets can be exported with the existing authenticated CLI:

```sh
pnpm intelligence:export --model both --site local-demo --page casino-halloween --revision demo-v1 --variant control --source seeded --from 2026-11-01 --to 2026-11-25 --output .local/intelligence-dataset.json
```

This creates `intelligence-dataset-sasrec.json` and `intelligence-dataset-eulernet.json`. Use `--model eulernet` for only click examples; the default remains `sasrec`. Train each with its respective script. If one export fails, a previously written export is not silently removed; the command fails and the error identifies the missing prerequisite.

## EulerNet evaluation and real-product use

EulerNet uses the same chronological whole-view 70/15/15 partition and overlap purge as SASRec, on its eligible exposure views. Each partition must meet the site's minimum view cohort and contain at least that many positive and negative examples (one of each for a synthetic site). Each retained element and feature category needs minimum distinct-view support in training; rare context values use an unknown category. Unseen evaluation elements cause training to fail rather than quietly dropping the hard cases. Training masks context fields occasionally so the unknown representation is learned. Candidate elements are never masked and unsupported serving elements are rejected.

The trainer selects checkpoints by validation log loss, fits monotone Platt calibration on validation views, and evaluates the untouched later test set. It trains a categorical logistic-regression baseline with the same inputs/splits and calibration procedure, plus a constant probability from the training click rate. The dashboard compares log loss, Brier score and expected calibration error (10 fixed-width probability bins), and reports EulerNet AUC. No negative downsampling or class weighting changes the observed prevalence. The exported labels, architecture and tests form a working implementation; they do not establish that the neural model is better for Infrared's traffic.

Validation states are deliberately explicit:

| State | Meaning |
| --- | --- |
| `fixture_only` | Seeded data or a synthetic site. Validates the pipeline; not production evidence. |
| `needs_review` | A real-site, recorded-data model did not beat both baselines on test log loss or its test calibration error exceeded 0.10. |
| `passes_offline_checks` | A real-site recorded model beat both baselines on test log loss and test calibration error was at most 0.10. This is a diagnostic threshold, not deployment approval or proof of lift. |

Neither EulerNet nor SASRec is mandatory. For a real product, keep the simpler baseline if it performs as well or better, inspect calibration and exposure coverage on representative future traffic, monitor drift, and validate any resulting product change through the existing experiment process. There is no automatic personalization, campaign change, rollout or production approval in this integration. Public inference deployment remains outside the verified native path.

The joint endpoint preserves the two objectives: SASRec's next observed action is not EulerNet's click-within-30-seconds outcome. It does not multiply a SASRec ranking logit by a click estimate, present a blended number as a probability, or silently rerank a different target. Both installed artifacts must match the same current scope/evidence version and pass expiry/cohort checks. The API rechecks both after inference; withdrawal invalidates both immediately and retention prunes both model directories.

Additional endpoints:

- `GET /api/intelligence/euler/dataset`: owner/administrator, same scope/date query and export controls as sequence export.
- `GET /api/intelligence/euler/status`: reporting roles and site membership; status plus calibration/baseline metrics when ready.
- `POST /api/intelligence/euler/predict`: scope, `history` ending at a first exposure, and `device` (`mobile`, `tablet`, `desktop`).
- `POST /api/intelligence/analyze`: the same body plus `top_k`; returns separate `sasrec` and `eulernet` objects.

All writes require the existing same-origin/session/CSRF controls. Predictions share the 10-per-minute user limit and a serialized local inference worker. A joint request runs the two bounded processes sequentially; each has a 15-second timeout. Authentication, membership, expiry and privacy deletion apply to both models. Source fixtures for browser tests are inserted only into their disposable synthetic database when the optional Python model-test profile is enabled.

```powershell
npm run typecheck
npx vitest run tests/intelligence.test.ts tests/eulernet.test.ts
.local/intelligence-venv/Scripts/python.exe -m unittest discover -s apps/intelligence -p 'test_*.py' -v
# Enable the real exported-dataset -> training -> authenticated inference test:
$env:INFRARED_INTELLIGENCE_PYTHON=(Resolve-Path '.local/intelligence-venv/Scripts/python.exe').Path
npx vitest run tests/intelligence.test.ts tests/eulernet.test.ts
npm run build
npm run test:e2e -- tests/e2e/intelligence.spec.ts
```

The optional Python integration tests use disposable storage and validate individual and joint inference plus withdrawal invalidation. Without the interpreter environment variable, those two tests are skipped; the remaining API/dataset tests still run without Python. Two browser tests also require the optional runtime. The fixture interaction test checks that EulerNet can learn a controlled XOR relationship beyond an additive logistic model; this is a capability test, not a real-traffic performance claim.
