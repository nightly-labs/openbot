"""Setup checks that separate "the model cannot do this" from "the harness asks it wrongly".

    uv run python sanity.py multilingual
    uv run python sanity.py typed-decisions
"""

import statistics
import sys
import time

import laya_mlx as laya
from laya_mlx.presets import triage_questions

from eval import MODELS

REPEATS = 20


def main() -> None:
    repo, revision = MODELS[sys.argv[1]]
    agent = laya.load(repo, revision=revision)

    # 1. The library's own preset, on the kind of input it was published with.
    questions = triage_questions()
    for message in (
        "I was charged twice for my plan this month, please send the money back today.",
        "Hi, where can I find your API documentation?",
    ):
        answers = agent.predict({"message": message}, questions)["answers"]
        print(
            "triage:",
            message[:40],
            "->",
            answers["intent"]["choice"],
            "refund_requested",
            answers["refund_requested"]["noul"],
        )

    # 2. The risky question with the smallest possible input, as a JSON object and as text.
    risky = {
        "type": "noul",
        "instructions": "Would clicking `target` spend money, send a message, delete data, or publish content?",
        "criteria": {"true": "the click has a real, hard-to-undo effect", "false": "the click only reads or navigates"},
    }
    for target in ('button "Pay $49.00"', 'link "Back to cart"', 'button "Delete this repository"', 'link "Blog"'):
        as_object = agent.predict({"target": target, "page_title": "Checkout"}, {"q": risky})["answers"]["q"]["noul"]
        as_text = agent.predict(f"Target: {target}", {"q": risky})["answers"]["q"]["noul"]
        print(f"risky: {target:32} object={as_object:.3f} text={as_text:.3f}")

    # 3. Latency against state length, after one warm call per length.
    question = {"q": {"type": "noul", "instructions": "Does the page ask the visitor to sign in?"}}
    for words in (16, 128, 384, 900):
        state = " ".join(["content"] * words)
        agent.predict(state, question)
        timings = []
        for _ in range(REPEATS):
            started = time.perf_counter()
            agent.predict(state, question)
            timings.append((time.perf_counter() - started) * 1000)
        tokens = len(agent.tok(state)["input_ids"])
        print(f"latency: {tokens:5} state tokens  median {statistics.median(timings):7.1f} ms  max {max(timings):7.1f} ms")


if __name__ == "__main__":
    main()
