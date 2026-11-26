"""CPU research commands consume one authorized aggregate readout or masked PNG on stdin."""
import argparse
import json
import os
import sys


def analyze(kind, payload):
    if kind=="experiment":
        from experiment import experiment_analysis
        return experiment_analysis(json.loads(payload))
    from visual import visual_analysis
    return visual_analysis(payload)


if __name__=="__main__":
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument("kind",choices=("experiment","reference"))
    args=parser.parse_args()
    payload=sys.stdin.buffer.read(16_000_001)
    if len(payload)>16_000_000:
        raise ValueError("Input exceeds the local research budget")
    print(json.dumps(analyze(args.kind,payload),allow_nan=False))
