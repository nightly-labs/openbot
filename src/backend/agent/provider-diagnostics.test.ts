// @vitest-environment node

import { classifyFailure } from "@openbot/telemetry";
import { describe, expect, it } from "vitest";
import { isBalanceDiagnostic, isPlanLimitDiagnostic, isUsageLimitDiagnostic } from "./provider-diagnostics";

const CLAUDE_SPEND_WINDOW_MESSAGE =
  "You've hit your individual spend limit · run /usage-credits to raise it, or visit https://claude.ai/admin-settings/usage · your 5-hour limit resets 8am (Europe/Lisbon)";

describe("provider usage-limit diagnostics", () => {
  it("classifies Claude's 5-hour individual spend limit window as a resetting plan limit, not a spent balance", () => {
    expect(isBalanceDiagnostic(CLAUDE_SPEND_WINDOW_MESSAGE)).toBe(false);
    expect(isPlanLimitDiagnostic(CLAUDE_SPEND_WINDOW_MESSAGE)).toBe(true);
    expect(isUsageLimitDiagnostic(CLAUDE_SPEND_WINDOW_MESSAGE)).toBe(true);
    expect(classifyFailure(CLAUDE_SPEND_WINDOW_MESSAGE)).toBe("usage_limit");
  });

  it("still treats genuine exhausted credit balances without a resetting window as balance diagnostics", () => {
    const exhaustedBalance = "Your credit balance is too low to access the Anthropic API.";
    expect(isBalanceDiagnostic(exhaustedBalance)).toBe(true);
    expect(isPlanLimitDiagnostic(exhaustedBalance)).toBe(false);
    expect(isUsageLimitDiagnostic(exhaustedBalance)).toBe(true);
  });

  it("treats Codex Plus/Pro usage limits that mention purchasing credits alongside 'try again at' as plan limits", () => {
    const codexMessage =
      "You've hit your usage limit. Visit https://chatgpt.com/codex/settings/usage to purchase more credits or try again at 3:00 PM.";
    expect(isBalanceDiagnostic(codexMessage)).toBe(true);
    expect(isPlanLimitDiagnostic(codexMessage)).toBe(true);
    expect(classifyFailure(codexMessage)).toBe("usage_limit");
  });
});
