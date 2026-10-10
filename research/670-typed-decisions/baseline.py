"""Cheap deterministic rules on the same snapshots, to show whether the model adds anything.

The rules and the fixtures have the same author, so these scores are optimistic. The Laya
questions in eval.py were written with the same knowledge, so the comparison is even-handed.
"""

import re

from state import text_diff

CAPTCHA = re.compile(r"captcha|not a robot|verify you are human|security check|unusual traffic|安全验证|滑块", re.I)
CHECKOUT = re.compile(
    r"\bpay\b|place order|checkout|card number|cvc|blik|zapłać|do zapłaty|confirm (your )?transfer|charged|payment", re.I
)
LOGIN_FIELD = re.compile(r"password|hasło|密码|verification code|one-time", re.I)
LOGIN_BUTTON = re.compile(r"continue with (google|microsoft|apple|email)|^log in$|^zaloguj$", re.I)
ERROR = re.compile(r"\b404\b|\b500\b|not found|nie znaleziono|went wrong|can't be reached|err_[a-z_]+", re.I)
COOKIE = re.compile(r"cookie|plików cookie", re.I)
RISKY = re.compile(
    r"\bpay\b|buy|order|purchase|send|post|publish|delete|remove|discard|transfer|zapłać|usuń|wyślij|购买|支付|删除|发送",
    re.I,
)
SUCCESS = re.compile(r"thanks|has been sent|saved|added to|results for|check your inbox|we sent", re.I)
FAILURE = re.compile(
    r"error|could not|couldn't|sorry|please enter|went wrong|not found|out of stock|not applied|invalid", re.I
)


def page_state(snapshot: dict) -> str:
    elements = snapshot.get("elements") or []
    haystack = f"{snapshot.get('title', '')} {snapshot.get('text', '')}"
    if CAPTCHA.search(haystack):
        return "captcha"
    if CHECKOUT.search(haystack):
        return "checkout"
    for element in elements:
        name = " ".join(str(element.get("name") or "").split())
        if element.get("role") == "textbox" and LOGIN_FIELD.search(name):
            return "login"
        if element.get("role") == "button" and LOGIN_BUTTON.search(name):
            return "login"
    if ERROR.search(haystack):
        return "error"
    if COOKIE.search(haystack):
        return "cookie_banner"
    return "content"


def risky(name: str) -> bool:
    return bool(RISKY.search(name))


def shortlist(goal: str, labels: list) -> str:
    words = set(re.findall(r"\w+", goal.lower()))

    def overlap(label: str) -> float:
        label_words = set(re.findall(r"\w+", label.lower()))
        return len(words & label_words) / (len(label_words) or 1)

    return max(labels, key=overlap)


def action_success(before: dict, after: dict) -> bool:
    if before.get("url") != after.get("url"):
        return True
    diff = text_diff(before, after)
    added = next(line for line in diff.splitlines() if line.startswith("Text added:"))
    elements_added = next(line for line in diff.splitlines() if line.startswith("Elements added:"))
    if FAILURE.search(added):
        return False
    return bool(SUCCESS.search(added)) or "dialog" in elements_added
