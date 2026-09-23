import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parse } from "yaml";

// The review step decides whether a reviewer's answer can pass the gate. A reviewer that
// read no code answered in the shape of a clean review and passed, so this runs the real
// step, lifted from the workflow file, against a small repository and a fake `codex` that
// answers with a given review and with or without a tool call.

const WORKFLOW = join(import.meta.dirname, "../.github/workflows/norbiai-review.yml");
const PROMPT = join(import.meta.dirname, "../.github/norbiai-review-prompt.md");

type Step = { name: string; run?: string; env?: Record<string, string> };
const steps: Step[] = parse(readFileSync(WORKFLOW, "utf8")).jobs.review.steps;
const step = steps.find((candidate) => candidate.name === "Run NorbiAI review");

const CLEAN = "## Verdict\n\nNo actionable findings exist.\n\n";
const BLIND =
  "## Verdict\n\nUnable to complete the review because the repository inspection tool session was unavailable, so I could not verify the PR diff.\n\n";
const LEDGER =
  "## Resolved Since Previous Review\n\nNone.\n\n## Findings\n\nNo actionable findings.\n\n## Withdrawn Findings\n\nNone.\n";

// Prints the prompt as Codex does, then an `exec` block when the reviewer reads with a
// tool, then the review. With an `error` file, it prints that error and exits 1 instead.
const FAKE_CODEX = `#!/usr/bin/env bash
if [ "$1" = mcp ]; then echo '[]'; exit 0; fi
while [ $# -gt 0 ]; do
  if [ "$1" = --output-last-message ]; then out=$2; fi
  shift
done
calls=$(( $(cat "$FAKE_DIR/calls" 2>/dev/null || echo 0) + 1 ))
echo "$calls" > "$FAKE_DIR/calls"
tee "$FAKE_DIR/prompt-$calls.txt"
if [ -f "$FAKE_DIR/error" ]; then cat "$FAKE_DIR/error"; exit 1; fi
cp "$FAKE_DIR/review.txt" "$out"
if [ -f "$FAKE_DIR/reads" ]; then printf 'exec\\n/bin/bash -lc "git diff"\\n'; fi
cat "$out"
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
  writeFileSync(join(bin, "codex"), FAKE_CODEX);
  // macOS has no `timeout`, the fake reviewer never runs long, and a busy bridge need
  // not be waited for.
  writeFileSync(join(bin, "timeout"), '#!/usr/bin/env bash\nshift\nexec "$@"\n');
  writeFileSync(join(bin, "sleep"), "#!/usr/bin/env bash\n");
  for (const tool of ["codex", "timeout", "sleep"]) chmodSync(join(bin, tool), 0o755);
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
      MODEL: "chatgpt-web/pro",
      EFFORT: "low",
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
  const published = existsSync(outputs.review_file) ? readFileSync(outputs.review_file, "utf8") : "";
  return { outputs, calls, prompt, published };
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

  it("waits for a busy bridge, but not for a prompt that names the busy error", () => {
    const stopped = "ERROR: stream disconnected before completion: ChatGPT stopped responding.\n";
    const failed = review({ error: stopped, description: "Retry on simultaneous browser turns." });
    expect(failed.calls).toBe(1);
    expect(failed.outputs.failure_reason).toBe("Reviewer exited with code 1. Human review required.");

    const busy = review({ error: "ERROR: unexpected status 429: 5 simultaneous browser turns are running.\n" });
    expect(busy.calls).toBe(3);
  });
});
