import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import type { FullResult, Reporter, TestCase, TestResult } from "@playwright/test/reporter";

const logger = createOpenBotLogger("visual-coverage");
export const requiredVisualCases = ["chat", "streaming", "approval", "delegation-menu", "file-preview", "narrow-chat"];

export function visualCoverage(results: readonly { id: string; status: string }[]) {
  const missing = requiredVisualCases.filter(
    (id) => !results.some((entry) => entry.id === id && entry.status === "passed"),
  );
  return { missing, passed: missing.length === 0 && results.every((entry) => entry.status === "passed") };
}

export default class VisualReporter implements Reporter {
  readonly results: { id: string; status: string }[] = [];

  onTestEnd(test: TestCase, result: TestResult) {
    this.results.push({ id: test.title.split(" ")[0] ?? "", status: result.status });
  }

  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] } | undefined> {
    if (process.env.OPENBOT_E2E_SUITE !== "release") return;
    const coverage = visualCoverage(this.results);
    const status = result.status === "passed" && coverage.passed ? "passed" : "failed";
    const output = resolve(import.meta.dirname, "../../.openbot-build/visual");
    await mkdir(output, { recursive: true });
    await writeFile(
      resolve(output, "coverage.json"),
      JSON.stringify({ status, missing: coverage.missing, results: this.results }, null, 2),
    );
    if (status === "failed") logger.error("Required visual coverage failed.", { missing: coverage.missing });
    return { status };
  }
}
