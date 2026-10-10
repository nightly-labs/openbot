import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The review step decides whether a reviewer's answer can pass the gate. A reviewer that
// read no code answered in the shape of a clean review and passed, so this runs the real
// step, lifted from the workflow file, against a small repository and a fake `claude` that
// answers with a given review and with or without a tool call.

const WORKFLOW = join(import.meta.dirname, "../.github/workflows/norbiai-review.yml");
const PROMPT = join(import.meta.dirname, "../.github/norbiai-review-prompt.md");

type Step = { name: string; run?: string; env?: Record<string, string> };
const job: { env: Record<string, string>; steps: Step[] } = parse(readFileSync(WORKFLOW, "utf8")).jobs.review;
const steps = job.steps;
const step = steps.find((candidate) => candidate.name === "Run NorbiAI review");
const gate = steps.find((candidate) => candidate.name === "Block on unresolved P0 and P1 findings");

const CLEAN = "## Verdict\n\nNo actionable findings exist.\n\n";
const BLIND =
  "## Verdict\n\nUnable to complete the review because the repository inspection tool session was unavailable, so I could not verify the PR diff.\n\n";
const LEDGER =
  "## Resolved Since Previous Review\n\nNone.\n\n## Findings\n\nNo actionable findings.\n\n## Withdrawn Findings\n\nNone.\n";
// Writes events as Claude Code's \`stream-json\` does: a tool call when the reviewer reads,
// then the result, which carries the review or, with an \`error\` file, that error.
const FAKE_CLAUDE = `#!/usr/bin/env bun
import { appendFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
const dir = process.env.FAKE_DIR;
if (process.argv[2] === "--version") {
  console.log("2.1.282 (Claude Code)");
  process.exit(0);
}
const calls = (existsSync(dir + "/calls") ? Number(readFileSync(dir + "/calls", "utf8")) : 0) + 1;
writeFileSync(dir + "/calls", String(calls));
writeFileSync(dir + "/claude-args.txt", process.argv.slice(2).join("\\n"));
const prompt = await Bun.stdin.text();
writeFileSync(dir + "/prompt-" + calls + ".txt", prompt);
const emit = (event) => console.log(JSON.stringify(event));
emit({ type: "system", subtype: "init" });
if (existsSync(dir + "/reads")) {
  emit({ type: "assistant", message: { content: [{ type: "tool_use", name: "Bash", input: { command: "git diff" } }] } });
}
const usage = { input_tokens: 10, cache_read_input_tokens: 1000, output_tokens: 200 };
if (existsSync(dir + "/error")) {
  const error = readFileSync(dir + "/error", "utf8");
  emit({ type: "result", subtype: "success", is_error: true, api_error_status: 429, result: error, usage });
  process.exit(1);
}
emit({ type: "result", subtype: "success", is_error: false, result: readFileSync(dir + "/review.txt", "utf8"), usage });
`;

function git(cwd: string, ...args: string[]): string {
  return execFileSync("git", args, { cwd, encoding: "utf8" }).trim();
}

/** A repository whose one commit adds a small file and a large one. */
function repository(): { root: string; base: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), "norbiai-run-"));
  git(root, "init", "-q");
  git(root, "config", "user.email", "test@example.com");
  git(root, "config", "user.name", "Test");
  mkdirSync(join(root, ".github"));
  writeFileSync(join(root, ".github/norbiai-review-prompt.md"), readFileSync(PROMPT));
  git(root, "add", ".");
  git(root, "commit", "-qm", "base");
  const base = git(root, "rev-parse", "HEAD");
  writeFileSync(join(root, "small.ts"), "export const small = 1;\n");
  writeFileSync(join(root, "large.ts"), "export const large = 1;\n".repeat(400));
  git(root, "add", ".");
  git(root, "commit", "-qm", "head");
  return { root, base, head: git(root, "rev-parse", "HEAD") };
}

type Run = {
  review?: string;
  reads?: boolean;
  error?: string;
  description?: string;
  inlineLimit?: number;
  partialLimit?: number;
};

/** Runs the workflow step as the runner would, and reads back its outputs and prompts. */
function review({ review = "", reads = false, error, description = "", inlineLimit, partialLimit }: Run) {
  const { root, base, head } = repository();
  const temp = mkdtempSync(join(tmpdir(), "norbiai-runner-"));
  const bin = join(temp, "bin");
  mkdirSync(bin);
  writeFileSync(join(bin, "claude"), FAKE_CLAUDE);
  // macOS has no `timeout`, and the fake reviewer never runs long.
  writeFileSync(join(bin, "timeout"), '#!/usr/bin/env bash\nshift\nexec "$@"\n');
  for (const tool of ["claude", "timeout"]) chmodSync(join(bin, tool), 0o755);
  writeFileSync(join(temp, "review.txt"), review);
  if (reads) writeFileSync(join(temp, "reads"), "");
  if (error) writeFileSync(join(temp, "error"), error);
  for (const file of ["title", "previous", "withdrawn", "responses", "output"]) {
    writeFileSync(join(temp, `${file}.txt`), file === "title" ? "Test" : "");
  }
  writeFileSync(join(temp, "body.txt"), description);
  const scriptPath = join(temp, "run.sh");
  writeFileSync(scriptPath, step?.run ?? "");

  execFileSync("bash", [scriptPath], {
    cwd: root,
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      FAKE_DIR: temp,
      RUNNER_TEMP: temp,
      GITHUB_OUTPUT: join(temp, "output.txt"),
      PR_NUMBER: "1",
      BASE_SHA: base,
      HEAD_SHA: head,
      PR_TITLE_FILE: join(temp, "title.txt"),
      PR_BODY_FILE: join(temp, "body.txt"),
      PREVIOUS_FILE: join(temp, "previous.txt"),
      WITHDRAWN_FILE: join(temp, "withdrawn.txt"),
      RESPONSES_FILE: join(temp, "responses.txt"),
      MODEL: job.env.MODEL,
      EFFORT: job.env.EFFORT,
      REVIEWED_SHA: "",
      FULL_REVIEW: "false",
      INLINE_DIFF_MAX_BYTES: String(inlineLimit ?? step?.env?.INLINE_DIFF_MAX_BYTES),
      PARTIAL_DIFF_MAX_BYTES: String(partialLimit ?? step?.env?.PARTIAL_DIFF_MAX_BYTES),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const outputs = Object.fromEntries(
    readFileSync(join(temp, "output.txt"), "utf8")
      .split("\n")
      .filter(Boolean)
      .map((line) => [line.slice(0, line.indexOf("=")), line.slice(line.indexOf("=") + 1)]),
  );
  const calls = Number(readFileSync(join(temp, "calls"), "utf8"));
  const prompt = readFileSync(join(temp, "prompt-1.txt"), "utf8");
  const reviewFile = outputs.review_file;
  const published = reviewFile && existsSync(reviewFile) ? readFileSync(reviewFile, "utf8") : "";
  const argsPath = join(temp, "claude-args.txt");
  const claudeArgs = existsSync(argsPath) ? readFileSync(argsPath, "utf8").split("\n") : [];
  return { outputs, calls, prompt, published, claudeArgs };
}

describe("NorbiAI review run", () => {
  it("passes a clean review of a diff that fits in the prompt", () => {
    const run = review({ review: CLEAN + LEDGER, reads: false });

    expect(run.outputs.status).toBe("success");
    expect(run.calls).toBe(1);
    expect(run.prompt).toContain("+export const small = 1;");
    expect(run.prompt).toContain("+export const large = 1;");
  });

  it("puts the files that fit in the prompt and lists the rest to read", () => {
    const run = review({ review: CLEAN + LEDGER, reads: true, inlineLimit: 2_000, partialLimit: 2_000 });

    expect(run.outputs.status).toBe("success");
    expect(run.prompt).toContain("+export const small = 1;");
    expect(run.prompt).not.toContain("+export const large = 1;");
    expect(run.prompt).toMatch(/These files are not in the prompt\. .*\n\n- large\.ts\n/);
  });

  it("retries once and then fails a review that read none of the diff left out of the prompt", () => {
    const run = review({ review: CLEAN + LEDGER, reads: false, inlineLimit: 2_000, partialLimit: 2_000 });

    expect(run.calls).toBe(2);
    expect(run.outputs.status).toBe("failed");
    expect(run.outputs.failure_reason).toBe("Reviewer did not read the code it had to review. Human review required.");
    expect(run.published).not.toContain("No actionable findings");
  });

  it("fails a review that says it could not inspect the code, even when the diff fits", () => {
    const run = review({ review: BLIND + LEDGER, reads: false });

    expect(run.calls).toBe(2);
    expect(run.outputs.status).toBe("failed");
    expect(run.outputs.failure_reason).toBe("Reviewer did not read the code it had to review. Human review required.");
  });

  it("keeps the part of a large diff small enough to leave room for the reads", () => {
    const run = review({ review: CLEAN + LEDGER, reads: true, inlineLimit: 2_000, partialLimit: 100 });

    expect(run.outputs.status).toBe("success");
    expect(run.prompt).not.toContain("+export const small = 1;");
    expect(run.prompt).toMatch(/\n- large\.ts\n- small\.ts\n/);
  });

  // The reviewer runs in the pull request's checkout. What the pull request put there must
  // not configure it, and its tools must not change anything.
  it("reviews read-only, without the checkout's settings, and publishes the result event", () => {
    const run = review({ review: CLEAN + LEDGER, reads: true, inlineLimit: 2_000, partialLimit: 2_000 });

    expect(run.outputs.status).toBe("success");
    expect(run.published).toContain("No actionable findings exist.");
    expect(run.outputs.tokens_used).toBe("1210");
    expect(run.outputs.claude_version).toBe("2.1.282");
    const args = run.claudeArgs.join(" ");
    expect(args).toContain("--setting-sources user --strict-mcp-config");
    expect(args).toContain("--tools Read,Grep,Glob,Bash --allowedTools");
    expect(args).toContain("--disallowedTools Bash(*--output*) Bash(*--no-index*)");
    expect(args).toContain(`--model ${job.env.MODEL} --effort ${job.env.EFFORT}`);
    expect(args).not.toMatch(/dangerously|bypassPermissions|--add-dir|--mcp-config/);
  });

  it("names the error from Claude Code's result event", () => {
    const run = review({ error: "Claude usage limit reached.\nTry again later." });

    expect(run.outputs.failure_reason).toBe(
      "Reviewer exited with code 1. Claude Code reported: API status 429: Claude usage limit reached. Human review required.",
    );
  });
});

/** Runs the gate step on a published review, and says whether it blocked. */
function blocks(findings: string): boolean {
  const temp = mkdtempSync(join(tmpdir(), "norbiai-gate-"));
  const reviewPath = join(temp, "review.txt");
  const scriptPath = join(temp, "gate.sh");
  writeFileSync(reviewPath, `${CLEAN}## Resolved Since Previous Review\n\nNone.\n\n## Findings\n\n${findings}\n`);
  writeFileSync(scriptPath, gate?.run ?? "");
  try {
    execFileSync("bash", [scriptPath], {
      env: { ...process.env, REVIEW_FILE: reviewPath, REVIEW_STATUS: "success", PUBLISH_OUTCOME: "success" },
      stdio: "pipe",
    });
    return false;
  } catch {
    return true;
  }
}

describe("NorbiAI gate", () => {
  it("blocks on a P0 or P1 finding, also when the reviewer escaped its brackets", () => {
    expect(blocks("1. **[NEW][P1] Short title** - `a.ts:1`")).toBe(true);
    expect(blocks("1. **\\[NEW\\]\\[P1\\] Storage scan follows attachment symlinks** - `a.ts:1`")).toBe(true);
    expect(blocks("1. **[REMAINS] [P0] Short title** - `a.ts:1`")).toBe(true);
    expect(blocks("1. **\\[NEW\\]\\[P2\\] Short title** - `a.ts:1`")).toBe(false);
    expect(blocks("No actionable findings.")).toBe(false);
  });
});
