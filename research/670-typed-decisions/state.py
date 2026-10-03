"""Turn an OpenBot browser snapshot into a compact Laya state that fits the token budget.

A raw snapshot is JSON with up to 200 elements and 100k characters of text. Laya reads at most
1024 tokens, including the question and its options, and silently cuts the state at the end.
This module packs the parts an agent would look at first and reports what it had to drop.
"""

import difflib
import re
from dataclasses import dataclass

# Tokens kept free for the question prefix is computed per question; this is the share of the
# remaining room given to the element list before the page text gets the rest.
ELEMENT_SHARE = 0.5
INJECTION = re.compile(r"(NOTE TO AI ASSISTANTS|Information for AI agents)[^\n]*?(answer no\.|safe and harmless\.)")


@dataclass
class Packed:
    text: str
    tokens: int
    source_tokens: int
    elements_kept: int
    elements_total: int

    @property
    def truncated(self) -> bool:
        return self.tokens < self.source_tokens


def element_label(element: dict) -> str:
    name = " ".join(str(element.get("name") or "").split())
    states = [s for s in element.get("states") or [] if not s.endswith(":false")]
    value = element.get("value")
    parts = [element.get("role", "element"), f'"{name}"' if name else "(no name)"]
    if value not in (None, ""):
        parts.append(f"value={str(value)[:40]!r}")
    if states:
        parts.append("[" + ", ".join(states) + "]")
    if element.get("disabled"):
        parts.append("[disabled]")
    return " ".join(parts)


def _count(tok, text: str) -> int:
    return len(tok(text)["input_ids"])


def _fit(tok, text: str, budget: int) -> str:
    ids = tok(text)["input_ids"]
    if len(ids) <= budget:
        return text
    return tok.backend.decode(ids[: max(0, budget)])


def pack(tok, snapshot: dict, budget: int, *, strip_injection: bool = False) -> Packed:
    text = " ".join(str(snapshot.get("text") or "").split())
    if strip_injection:
        text = INJECTION.sub("", text)
    header = f"Page title: {snapshot.get('title', '')}\nURL: {snapshot.get('url', '')}\n"
    lines = [element_label(e) for e in snapshot.get("elements") or []]
    full = header + "Elements:\n" + "\n".join(lines) + "\nPage text: " + text
    source_tokens = _count(tok, full)

    room = budget - _count(tok, header)
    element_budget = int(room * ELEMENT_SHARE)
    kept, used = [], _count(tok, "Elements:\n")
    for line in lines:
        cost = _count(tok, line + "\n")
        if used + cost > element_budget:
            break
        kept.append(line)
        used += cost
    body = header + "Elements:\n" + "\n".join(kept) + "\nPage text: "
    packed = body + _fit(tok, text, budget - _count(tok, body))
    return Packed(packed, _count(tok, packed), source_tokens, len(kept), len(lines))


def text_diff(before: dict, after: dict) -> str:
    """What an action changed: URL, title, added and removed text, added and removed elements."""
    parts = []
    if before.get("url") != after.get("url"):
        parts.append(f"URL changed from {before.get('url')} to {after.get('url')}")
    if before.get("title") != after.get("title"):
        parts.append(f"Title changed to {after.get('title')}")
    old, new = str(before.get("text") or "").split(), str(after.get("text") or "").split()
    added, removed = [], []
    for op, i1, i2, j1, j2 in difflib.SequenceMatcher(a=old, b=new, autojunk=False).get_opcodes():
        if op in ("insert", "replace"):
            added.append(" ".join(new[j1:j2]))
        if op in ("delete", "replace"):
            removed.append(" ".join(old[i1:i2]))
    old_elements = {element_label(e) for e in before.get("elements") or []}
    new_elements = {element_label(e) for e in after.get("elements") or []}
    parts.append("Text added: " + (" | ".join(added) if added else "(none)"))
    parts.append("Text removed: " + (" | ".join(removed) if removed else "(none)"))
    appeared = sorted(new_elements - old_elements)
    gone = sorted(old_elements - new_elements)
    parts.append("Elements added: " + ("; ".join(appeared) if appeared else "(none)"))
    parts.append("Elements removed: " + ("; ".join(gone) if gone else "(none)"))
    return "\n".join(parts)


def describe_steps(steps: list) -> str:
    out = []
    for step in steps:
        target = f'{step["role"]} "{step["name"]}"'
        if step["tool"] == "type":
            out.append(f'type "{step["text"]}" into {target}' + (" and press Enter" if step.get("submit") else ""))
        elif step["tool"] == "set_checked":
            out.append(f"{'check' if step.get('checked', True) else 'uncheck'} {target}")
        else:
            out.append(f"click {target}")
    return "; ".join(out)
