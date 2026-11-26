"""Local, causal SASRec for registered Infrared actions. No visitor identifiers."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import random
import sys
import uuid

import torch
from torch import nn
from torch.nn import functional as F

torch.set_num_threads(1)


def timestamp(value):
    return datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp()


class Block(nn.Module):
    def __init__(self, hidden, heads, dropout):
        super().__init__()
        self.norm1 = nn.LayerNorm(hidden)
        self.attention = nn.MultiheadAttention(hidden, heads, dropout=dropout, batch_first=True)
        self.norm2 = nn.LayerNorm(hidden)
        self.feed_forward = nn.Sequential(nn.Linear(hidden, hidden * 4), nn.ReLU(),
                                          nn.Dropout(dropout), nn.Linear(hidden * 4, hidden), nn.Dropout(dropout))

    def forward(self, x, mask):
        normalized = self.norm1(x)
        x = x + self.attention(normalized, normalized, normalized, attn_mask=mask, need_weights=False)[0]
        return x + self.feed_forward(self.norm2(x))


class SASRec(nn.Module):
    def __init__(self, items, max_length=50, hidden=64, heads=2, layers=2, dropout=0.2):
        super().__init__()
        self.max_length = max_length
        self.items = nn.Embedding(items + 1, hidden, padding_idx=0)
        self.positions = nn.Embedding(max_length, hidden)
        nn.init.normal_(self.items.weight, std=0.02)
        nn.init.normal_(self.positions.weight, std=0.02)
        with torch.no_grad():
            self.items.weight[0].zero_()
        self.dropout = nn.Dropout(dropout)
        self.blocks = nn.ModuleList([Block(hidden, heads, dropout) for _ in range(layers)])
        self.norm = nn.LayerNorm(hidden)

    def forward(self, ids):
        length = ids.shape[1]
        x = self.dropout(self.items(ids) + self.positions(torch.arange(length, device=ids.device)))
        mask = torch.ones(length, length, dtype=torch.bool, device=ids.device).triu(1)
        # Right padding: valid queries cannot attend to any padded position through the causal mask.
        for block in self.blocks:
            x = block(x, mask)
        logits = self.norm(x) @ self.items.weight.T
        return logits.masked_fill(torch.arange(logits.shape[-1], device=ids.device) == 0, -1e9)


def split_sequences(sequences):
    """Whole views, chronological holdout; purge views overlapping the next partition."""
    ordered = sorted(sequences, key=lambda s: (s["started_at"], s["ended_at"]))
    if len(ordered) < 10:
        raise ValueError("At least 10 eligible page-view sequences are required")
    a, b = int(len(ordered) * 0.7), int(len(ordered) * 0.85)
    validation_start, test_start = timestamp(ordered[a]["started_at"]), timestamp(ordered[b]["started_at"])
    train = [s for s in ordered[:a] if timestamp(s["ended_at"]) < validation_start]
    validation = [s for s in ordered[a:b] if timestamp(s["ended_at"]) < test_start]
    test = ordered[b:]
    if not train or not validation or not test:
        raise ValueError("Insufficient non-overlapping chronological train/validation/test sequences")
    return train, validation, test


def make_vocabulary(train, minimum):
    support = Counter(t for s in train for t in set(s["tokens"]))
    return sorted(t for t, n in support.items() if n >= minimum)


def supported_training(sequences, minimum):
    """Ensure support remains sufficient after excluding views with unsupported actions."""
    while True:
        vocabulary = make_vocabulary(sequences, minimum)
        known = set(vocabulary)
        retained = [s for s in sequences if all(t in known for t in s["tokens"])]
        if len(retained) == len(sequences):
            return retained, vocabulary
        sequences = retained


def encode(tokens, token_ids):
    # Unknown actions are rejected rather than collapsed, which would invent transitions.
    return [token_ids[t] for t in tokens] if all(t in token_ids for t in tokens) else None


def training_windows(train, token_ids, max_length):
    windows = []
    for s in train:
        ids = encode(s["tokens"], token_ids)
        if ids is None:
            continue
        for start in range(0, len(ids) - 1, max_length):
            chunk = ids[start:start + max_length + 1]
            if len(chunk) > 1:
                windows.append((chunk[:-1], chunk[1:]))
    if not windows:
        raise ValueError("No trainable sequences after action support filtering")
    return windows


def batch_tensors(windows):
    length = max(len(x) for x, _ in windows)
    inputs = torch.zeros(len(windows), length, dtype=torch.long)
    targets = torch.zeros_like(inputs)
    for i, (x, y) in enumerate(windows):
        inputs[i, :len(x)] = torch.tensor(x)
        targets[i, :len(y)] = torch.tensor(y)
    return inputs, targets


def baseline_counts(train, token_ids):
    popularity, transitions = Counter(), defaultdict(Counter)
    for s in train:
        ids = encode(s["tokens"], token_ids)
        if ids is None:
            continue
        popularity.update(ids[1:])
        for a, b in zip(ids, ids[1:]):
            transitions[a][b] += 1
    return popularity, transitions


def ranked(scores):
    return sorted(scores, key=lambda i: (-scores[i], i))


@torch.inference_mode()
def evaluate(model, sequences, token_ids, popularity, transitions, k):
    model.eval()
    totals = {name: {"hit_rate": 0.0, "ndcg": 0.0} for name in ("sasrec", "markov", "popularity")}
    unknown, n = 0, len(sequences)
    for s in sequences:
        ids = encode(s["tokens"], token_ids)
        if ids is None:
            unknown += 1
            continue  # Counts as a miss for all models in the denominator.
        history, target = ids[:-1][-model.max_length:], ids[-1]
        logits = model(torch.tensor([history]))[0, -1].tolist()
        candidates = [i for token, i in token_ids.items() if token != "page_view"]
        rankings = {
            "sasrec": ranked({i: logits[i] for i in candidates}),
            "popularity": ranked({i: popularity[i] for i in candidates}),
            "markov": sorted(candidates, key=lambda i: (-transitions[history[-1]][i], -popularity[i], i)),
        }
        for name, ranking in rankings.items():
            if target in ranking[:k]:
                totals[name]["hit_rate"] += 1
                totals[name]["ndcg"] += 1 / math.log2(ranking.index(target) + 2)
    for values in totals.values():
        for metric in values:
            values[metric] /= n
    return {"test_sequences": n, "unknown_targets": unknown, "k": k, **totals}


def validate_dataset(dataset):
    if dataset.get("schema_version") != 1 or dataset["scope"]["data_source"] not in ("recorded", "seeded"):
        raise ValueError("Unsupported dataset schema or data source")
    if timestamp(dataset["expires_at"]) <= datetime.now(timezone.utc).timestamp():
        raise ValueError("Dataset has expired; export fresh retained activity")
    if not isinstance(dataset["minimum_token_views"], int) or dataset["minimum_token_views"] < 1:
        raise ValueError("Invalid minimum action support")
    for s in dataset["sequences"]:
        if len(s["tokens"]) < 2 or len(s["tokens"]) > 20000 or s["tokens"][0] != "page_view":
            raise ValueError("Invalid action sequence")
        if timestamp(s["started_at"]) > timestamp(s["ended_at"]) or timestamp(s["ended_at"]) > timestamp(dataset["exported_at"]):
            raise ValueError("Invalid sequence timestamps")


def scope_key(scope):
    values = [scope[k] for k in ("site_id", "page_key", "data_source", "revision", "variant")]
    return hashlib.sha256(json.dumps(values, separators=(",", ":"), ensure_ascii=False).encode()).hexdigest()


def train(args):
    random.seed(args.seed)
    torch.manual_seed(args.seed)
    torch.use_deterministic_algorithms(True)
    dataset = json.loads(Path(args.dataset).read_text(encoding="utf-8-sig"))
    validate_dataset(dataset)
    train_set, validation, test = split_sequences(dataset["sequences"])
    if len(test) < dataset["minimum_token_views"]:
        raise ValueError("Held-out page views must also meet the minimum cohort; export more activity")
    original_training_count = len(train_set)
    train_set, vocabulary = supported_training(train_set, dataset["minimum_token_views"])
    if len(vocabulary) < 2:
        raise ValueError("At least two actions must meet training-only minimum view support")
    token_ids = {t: i + 1 for i, t in enumerate(vocabulary)}
    windows = training_windows(train_set, token_ids, args.max_length)
    settings = dict(items=len(vocabulary), max_length=args.max_length, hidden=args.hidden,
                    heads=2, layers=2, dropout=0.2)
    model = SASRec(**settings)
    optimizer = torch.optim.Adam(model.parameters(), lr=0.001)
    popularity, transitions = baseline_counts(train_set, token_ids)
    k = min(5, len(vocabulary) - 1)
    best, best_state, best_epoch = -1, None, 0
    history = []
    for epoch in range(args.epochs):
        model.train()
        random.shuffle(windows)
        total_loss, examples = 0.0, 0
        for start in range(0, len(windows), 64):
            x, y = batch_tensors(windows[start:start + 64])
            optimizer.zero_grad()
            loss = F.cross_entropy(model(x).reshape(-1, len(vocabulary) + 1), y.reshape(-1), ignore_index=0)
            if not torch.isfinite(loss):
                raise ValueError("Nonfinite training loss; no checkpoint was published")
            loss.backward()
            nn.utils.clip_grad_norm_(model.parameters(), 5)
            optimizer.step()
            total_loss += float(loss.detach()) * int((y != 0).sum())
            examples += int((y != 0).sum())
        validation_metrics = evaluate(model, validation, token_ids, popularity, transitions, k)
        score = validation_metrics["sasrec"]["ndcg"]
        point = dict(phase="sasrec", epoch=epoch + 1, epochs=args.epochs,
                     loss=total_loss / examples, validation_ndcg=score)
        history.append(point)
        if getattr(args, "progress", False):
            print(json.dumps(dict(event="progress", **point), allow_nan=False), flush=True)
        if score > best:
            best, best_epoch = score, epoch + 1
            best_state = {k: v.detach().clone() for k, v in model.state_dict().items()}
    model.load_state_dict(best_state)
    evaluation = evaluate(model, test, token_ids, popularity, transitions, k)
    model_id = str(uuid.uuid4())
    manifest = dict(schema_version=1, model="SASRec", model_id=model_id, scope=dataset["scope"],
                    created_at=datetime.now(timezone.utc).isoformat(), expires_at=dataset["expires_at"],
                    oldest_started_at=min(s["started_at"] for s in dataset["sequences"]),
                    vocabulary=vocabulary, max_length=args.max_length, evaluation=evaluation,
                    minimum_token_views=dataset["minimum_token_views"],
                    training=dict(sequences=len(train_set), validation_sequences=len(validation),
                                  unsupported_training_sequences=original_training_count - len(train_set),
                                  windows=len(windows), best_epoch=best_epoch, seed=args.seed,
                                  split="chronological whole-view 70/15/15 with overlap purge",
                                  minimum_token_views=dataset["minimum_token_views"], history=history))
    directory = Path(args.output_dir) if getattr(args, "output_dir", None) else Path(args.data_dir) / "intelligence" / scope_key(dataset["scope"])
    directory.mkdir(parents=True, exist_ok=True, mode=0o700)
    weights_tmp, manifest_tmp = directory / (model_id + ".pt.tmp"), directory / (model_id + ".json.tmp")
    with os.fdopen(os.open(weights_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "wb") as output:
        torch.save(dict(model_id=model_id, settings=settings, state_dict=best_state), output)
    with os.fdopen(os.open(manifest_tmp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600), "w", encoding="utf-8") as output:
        output.write(json.dumps(manifest, indent=2, allow_nan=False))
    os.replace(weights_tmp, directory / "model.pt")
    os.replace(manifest_tmp, directory / "manifest.json")
    if not getattr(args, "output_dir", None):
        (directory / "active.json").unlink(missing_ok=True)
    print(json.dumps({"model_directory": str(directory), "evaluation": evaluation, "model_id": model_id}))


@torch.inference_mode()
def predict(args):
    directory = Path(args.model_dir)
    manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
    request = json.load(sys.stdin)
    if timestamp(manifest["expires_at"]) <= datetime.now(timezone.utc).timestamp():
        raise ValueError("Expired model")
    if request["model_id"] != manifest["model_id"]:
        raise ValueError("Model changed; retry")
    history, k = request["history"], request["top_k"]
    if not 1 <= len(history) <= 50 or not isinstance(k, int) or not 1 <= k <= 10:
        raise ValueError("Invalid prediction input")
    token_ids = {t: i + 1 for i, t in enumerate(manifest["vocabulary"])}
    ids = encode(history, token_ids)
    if ids is None:
        raise ValueError("Unknown action in history")
    checkpoint = torch.load(directory / "model.pt", map_location="cpu", weights_only=True)
    if checkpoint["model_id"] != manifest["model_id"]:
        raise ValueError("Model publication in progress; retry")
    model = SASRec(**checkpoint["settings"])
    model.load_state_dict(checkpoint["state_dict"])
    model.eval()
    scores = model(torch.tensor([ids[-model.max_length:]]))[0, -1].tolist()
    ranking = ranked({i: scores[i] for token, i in token_ids.items() if token != "page_view"})[:k]
    print(json.dumps(dict(model_id=manifest["model_id"], rankings=[
        dict(action=manifest["vocabulary"][i - 1], score=scores[i]) for i in ranking]), allow_nan=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    training = commands.add_parser("train")
    training.add_argument("--dataset", required=True)
    training.add_argument("--data-dir", default=os.environ.get("DATA_DIR", ".local"))
    training.add_argument("--epochs", type=int, default=20)
    training.add_argument("--max-length", type=int, default=50)
    training.add_argument("--hidden", type=int, default=64)
    training.add_argument("--seed", type=int, default=2026)
    training.add_argument("--output-dir")
    training.add_argument("--progress", action="store_true")
    prediction = commands.add_parser("predict")
    prediction.add_argument("--model-dir", required=True)
    args = parser.parse_args()
    if args.command == "train":
        if not 1 <= args.epochs <= 1000 or not 1 <= args.max_length <= 50 or not 4 <= args.hidden <= 256 or args.hidden % 2:
            parser.error("Invalid training hyperparameters")
        train(args)
    else:
        predict(args)


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError) as error:
        print(str(error), file=sys.stderr)
        sys.exit(1)
