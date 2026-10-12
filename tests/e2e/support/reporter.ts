import { mkdir, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { stripVTControlCharacters } from "node:util";
import { redactText, registerSecretValue } from "@openbot/logging";
import type { FullConfig, FullResult, Reporter, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { releaseBudgetMs, releaseCoverage } from "./coverage";
import { output, root } from "./settings";

// Line by line and without color codes: an unclosed `{` in an assertion diff, or the `[` of many color
// codes, must not hide the rest of the error. Each line still masks secret values and credential patterns.
function redactLines(value: string): string {
  return stripVTControlCharacters(value).split("\n").map(redactText).join("\n");
}

interface Result {
  id: string;
  mode: string;
  title: string;
  status: string;
  durationMs: number;
  errors: string[];
  screenshots: string[];
  annotations: { type: string; description?: string }[];
}

export default class ReleaseReporter implements Reporter {
  readonly results: Result[] = [];
  started = Date.now();
  readonly errors: string[] = [];
  readonly logs: string[] = [];

  onStdOut(chunk: string | Buffer) {
    const safe = redactText(chunk.toString());
    this.logs.push(safe.slice(-8_000));
    if (this.logs.length > 300) this.logs.shift();
    process.stdout.write(safe);
  }
  onStdErr(chunk: string | Buffer) {
    this.onStdOut(chunk);
  }

  onBegin(_config: FullConfig) {
    for (const [name, value] of Object.entries(process.env)) {
      if (!value || !/secret|token|password|key/i.test(name)) continue;
      registerSecretValue(value);
      // Errors are redacted line by line, so each line of a multi-line secret is masked on its own.
      for (const line of value.split("\n")) registerSecretValue(line.trim());
    }
  }
  onError(error: TestError) {
    const message = redactLines(error.message ?? "E2E setup or teardown failed.");
    this.errors.push(message);
    process.stderr.write(`${message}\n`);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const error of result.errors) {
      if (error.message) error.message = redactLines(error.message);
      if (error.stack) error.stack = redactLines(error.stack);
      if (error.snippet) error.snippet = redactLines(error.snippet);
    }
    const errors = result.errors.map((error) => error.message ?? "Test failed.");
    this.results.push({
      id: test.title.split(" ")[0] ?? "",
      mode: test.parent.project()?.name ?? "",
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      annotations: result.annotations,
      errors,
      screenshots: result.attachments.flatMap((attachment) =>
        attachment.contentType === "image/png" && attachment.path ? [relative(root, attachment.path)] : [],
      ),
    });
    process.stdout.write(`${result.status}: ${test.parent.project()?.name} / ${test.title}\n`);
    for (const error of errors) process.stdout.write(`${error}\n`);
  }
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    const suite = process.env.OPENBOT_E2E_SUITE;
    const required = suite === "release" ? "release" : suite === "scripted-release" ? "scripted" : null;
    const started = Number(process.env.OPENBOT_E2E_STARTED_AT ?? this.started);
    const elapsedMs = Date.now() - started;
    const budgetMs = process.env.CI ? releaseBudgetMs : null;
    const coverage = required ? releaseCoverage(this.results, elapsedMs, required, budgetMs) : null;
    const missing = coverage?.missing ?? [];
    const status = result.status === "passed" && (!coverage || coverage.passed) ? "passed" : "failed";
    const report = {
      status,
      commit: process.env.GITHUB_SHA ?? "local",
      platform: process.platform,
      elapsedMs,
      budgetMs,
      runtimeVersions: process.env.OPENBOT_E2E_RUNTIME_VERSIONS ?? null,
      missing,
      results: this.results,
      errors: this.errors,
    };
    await mkdir(join(output, "report"), { recursive: true });
    await writeFile(join(output, "report/runtime.log"), this.logs.join(""));
    await writeFile(join(output, "report/coverage.json"), redactText(JSON.stringify(report, null, 2)));
    const escapeHtml = (value: string) =>
      value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll('"', "&quot;");
    await writeFile(
      join(output, "report/index.html"),
      `<!doctype html><html lang="en"><meta charset="utf-8">
      <title>OpenBot release UI tests</title><h1>Release UI tests: ${status}</h1>
      <p>Commit: ${escapeHtml(report.commit)}. Platform: ${report.platform}. Time: ${Math.round(elapsedMs / 1000)} seconds.</p>
      <p>Missing: ${escapeHtml(missing.join(", "))}</p><table><thead><tr><th>Mode</th><th>Scenario</th><th>Result</th><th>Seconds</th></tr></thead>
      <tbody>${this.results.map((entry) => `<tr><td>${escapeHtml(entry.mode)}</td><td>${escapeHtml(entry.title)}</td><td>${entry.status}</td><td>${(entry.durationMs / 1000).toFixed(1)}</td></tr>`).join("")}</tbody></table>
      <pre>${escapeHtml(redactLines([...this.errors, ...this.results.flatMap((entry) => entry.errors)].join("\n")))}</pre></html>`,
    );
    return { status };
  }
}
