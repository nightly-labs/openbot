// Checks that the GitHub errors of workflow steps name the repository that needs access, with the real
// `createGitHubRest` and a fake GitHub API: a 404 on the options of a repository, a 403 on a comment, and a
// change in a repository where the app has no token each name `owner/name`. No network is used.
//
// Run: bun scripts/github-access-error-e2e.ts
// Writes .openbot-build/github-access-error-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { WorkflowGitHubChange } from "../src/backend/workflows/workflow-github-api";
import { createGitHubRest } from "../src/main/github-rest";

const OUT = resolve(import.meta.dirname, "../.openbot-build/github-access-error-e2e");

interface Report {
  checks: string[];
  messages: Record<string, string>;
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], messages: {}, passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

/** `acme/hidden` is not in the installation: 404. `acme/readonly` refuses changes: 403. */
const fakeGitHub = async (input: string): Promise<Response> => {
  const path = new URL(input).pathname;
  if (path.startsWith("/repos/acme/hidden/"))
    return new Response(JSON.stringify({ message: "Not Found" }), { status: 404 });
  if (path.startsWith("/repos/acme/readonly/"))
    return new Response(JSON.stringify({ message: "Resource not accessible by integration" }), { status: 403 });
  return new Response("[]", { status: 200 });
};

const api = createGitHubRest({
  fetch: (input) => fakeGitHub(String(input)),
  // `acme/user-only` has only the user's sign-in, so the app cannot change it.
  tokens: (repository) =>
    Effect.succeed({ user: "user-token", bot: repository === "acme/user-only" ? null : "app-token" }),
});

const comment = (repository: string): WorkflowGitHubChange => ({
  action: "comment",
  repository,
  number: 1,
  body: "Thanks.",
  title: "",
  labels: [],
  people: [],
  reason: "completed",
  files: null,
});

const message = async (name: string, effect: Effect.Effect<unknown, { message: string }>) => {
  const text = await Effect.runPromise(
    effect.pipe(
      Effect.map(() => ""),
      Effect.catch((failure) => Effect.succeed(failure.message)),
    ),
  );
  report.messages[name] = text;
  return text;
};

try {
  const hidden = await message("hidden", api.options("acme/hidden"));
  check(
    "a repository that the app cannot see is named in the error",
    hidden === sourceText("error.workflow.githubNoAccessRepository", { repository: "acme/hidden" }),
    hidden,
  );
  const readOnly = await message("readOnly", api.change(comment("acme/readonly")));
  check(
    "a repository that refuses a change is named in the error",
    readOnly === sourceText("error.workflow.githubNoWriteRepository", { repository: "acme/readonly" }),
    readOnly,
  );
  const userOnly = await message("userOnly", api.change(comment("acme/user-only")));
  check(
    "a repository where the app has no token is named in the error",
    userOnly === sourceText("error.workflow.githubNoWriteRepository", { repository: "acme/user-only" }),
    userOnly,
  );
  report.passed = true;
} catch (error) {
  report.failure = error instanceof Error ? (error.stack ?? error.message) : String(error);
  process.exitCode = 1;
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(
    `${report.passed ? "passed" : "failed"}: ${report.checks.length} checks; ${join(OUT, "report.json")}\n`,
  );
  if (report.failure) process.stderr.write(`${report.failure}\n`);
}
