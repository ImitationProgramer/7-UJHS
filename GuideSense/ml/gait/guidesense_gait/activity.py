"""Goal 3 CLI: prepare, train, evaluate, replay, infer, check-replay."""

import argparse
import json
from pathlib import Path

from .activity_data import build_dataset, prepare_session, label_window, verify_dataset
from .activity_model import ActivityModel
from .activity_replay import demo_selection, replay_dataset, validate_replay
from .activity_train import evaluate_test, train_model
from .adapters import read_dog_session
from .pipeline import make_window


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "command", choices=["prepare", "train", "evaluate", "replay", "infer", "check-replay"]
    )
    parser.add_argument(
        "--csv", type=Path, default=Path("data/external/mendeley-v4/DogMoveData.csv")
    )
    parser.add_argument("--dataset", type=Path, default=Path("artifacts/goal3/dataset"))
    parser.add_argument("--model", type=Path, default=Path("artifacts/goal3/model"))
    parser.add_argument("--output", type=Path, default=Path("artifacts/goal3/replay-demo"))
    parser.add_argument("--dog", type=int)
    parser.add_argument("--test", type=int)
    parser.add_argument("--start", type=float)
    parser.add_argument("--seconds", type=float, default=30)
    parser.add_argument("--demo", action="store_true")
    args = parser.parse_args()
    if args.command == "prepare":
        result = build_dataset(args.csv, args.dataset)
    elif args.command == "train":
        result = train_model(args.dataset, args.model)
    elif args.command == "evaluate":
        result = evaluate_test(args.dataset, args.model)
    elif args.command == "check-replay":
        result = validate_replay(args.output)
    else:
        if args.demo:
            args.dog, args.test, args.start = demo_selection(args.dataset)
        if any(x is None for x in (args.dog, args.test, args.start)):
            parser.error("provide --dog, --test, --start or --demo")
        if args.command == "replay":
            result = replay_dataset(
                args.csv, args.model, args.output, args.dog, args.test, args.start, args.seconds
            )
        else:
            verify_dataset(args.csv)
            table = read_dog_session(args.csv, args.dog, args.test)
            window = make_window(prepare_session(table), args.start)
            result = {
                **ActivityModel(args.model).predict_window(window),
                **label_window(table, args.start),
            }
    print(json.dumps(result, indent=2, ensure_ascii=False, allow_nan=False))


if __name__ == "__main__":
    main()
