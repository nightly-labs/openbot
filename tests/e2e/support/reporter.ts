import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { redactText, registerSecretValue } from "@openbot/logging";
import type { FullConfig, FullResult, Reporter, TestCase, TestError, TestResult } from "@playwright/test/reporter";
import { releaseCoverage } from "./coverage";
import { output } from "./settings";

interface Result {
  id: string;
  mode: string;
  title: string;
  status: string;
  durationMs: number;
  errors: string[];
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
      if (value && /secret|token|password|key/i.test(name)) registerSecretValue(value);
    }
  }
  onError(error: TestError) {
    const message = redactText(error.message ?? "E2E setup or teardown failed.");
    this.errors.push(message);
    process.stderr.write(`${message}\n`);
  }
  onTestEnd(test: TestCase, result: TestResult) {
    for (const error of result.errors) {
      if (error.message) error.message = redactText(error.message);
      if (error.stack) error.stack = redactText(error.stack);
      if (error.snippet) error.snippet = redactText(error.snippet);
    }
    this.results.push({
      id: test.title.split(" ")[0] ?? "",
      mode: test.parent.project()?.name ?? "",
      title: test.title,
      status: result.status,
      durationMs: result.duration,
      annotations: result.annotations,
      errors: result.errors.map((error) => error.message ?? "Test failed."),
    });
    process.stdout.write(`${result.status}: ${test.parent.project()?.name} / ${test.title}\n`);
  }
  async onEnd(result: FullResult): Promise<{ status: FullResult["status"] }> {
    const release = process.env.OPENBOT_E2E_SUITE === "release";
    const started = Number(process.env.OPENBOT_E2E_STARTED_AT ?? this.started);
    const elapsedMs = Date.now() - started;
    const coverage = releaseCoverage(this.results, elapsedMs);
    const missing = release ? coverage.missing : [];
    const status = result.status === "passed" && (!release || coverage.passed) ? "passed" : "failed";
    const report = {
      status,
      commit: process.env.GITHUB_SHA ?? "local",
      platform: process.platform,
      elapsedMs,
      budgetMs: 600_000,
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
      <pre>${escapeHtml(redactText([...this.errors, ...this.results.flatMap((entry) => entry.errors)].join("\n")))}</pre></html>`,
    );
    return { status };
  }
}
