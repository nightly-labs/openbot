// Checks the GitHub errors of workflow steps with the real `createGitHubRest` and a fake GitHub API. Each
// error says what needs access: the repository or the item, and the app or the user's own account. A read
// that GitHub refuses is a read error, not a write error, and a rate limit is not an access error. Each
// text also comes back in another language, so a client can translate it. No network is used.
//
// Run: bun scripts/github-access-error-e2e.ts
// Writes .openbot-build/github-access-error-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { localizeSourceText, sourceText } from "@openbot/i18n/source";
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

const answer = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers });

/**
 * `acme/hidden` is not in the installation: 404. `acme/readonly` refuses each call: 403. `acme/busy` is
 * at GitHub's secondary rate limit: 403 with requests left. `acme/app` has no issue 404. `acme/user-only`
 * has no app, the user cannot see it, and its pull request 7 has no reviews page.
 */
const fakeGitHub = async (input: string): Promise<Response> => {
  const path = new URL(input).pathname;
  if (path.startsWith("/repos/acme/hidden/")) return answer(404, { message: "Not Found" });
  if (path.startsWith("/repos/acme/readonly/"))
    return answer(403, { message: "Resource not accessible by integration" }, { "x-ratelimit-remaining": "4999" });
  if (path.startsWith("/repos/acme/busy/"))
    return answer(
      403,
      { message: "You have exceeded a secondary rate limit. Please wait a few minutes before you try again." },
      { "x-ratelimit-remaining": "4999", "retry-after": "60" },
    );
  if (path.startsWith("/repos/acme/app/issues/404/")) return answer(404, { message: "Not Found" });
  if (path === "/repos/acme/user-only/pulls") return answer(200, [{ number: 7 }]);
  if (path.startsWith("/repos/acme/user-only/")) return answer(404, { message: "Not Found" });
  return answer(200, []);
};

const api = createGitHubRest({
  fetch: (input) => fakeGitHub(String(input)),
  // `acme/user-only` has only the user's sign-in, so the app cannot change it and reads use the user's token.
  tokens: (repository) =>
    Effect.succeed({ user: "user-token", bot: repository === "acme/user-only" ? null : "app-token" }),
});

const comment = (repository: string, number = 1): WorkflowGitHubChange => ({
  action: "comment",
  repository,
  number,
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

/** The text is the English of a source key, so a client shows it in the reader's language. */
const translated = (name: string, text: string) => {
  const german = localizeSourceText(text, "de");
  report.messages[`${name}.de`] = german;
  check(`the ${name} text is translated`, german !== text && !german.includes("{"), german);
};

try {
  const hidden = await message("hidden", api.options("acme/hidden"));
  check(
    "a repository that the app cannot see is named in the error",
    hidden === sourceText("error.workflow.githubNoAccessRepository", { repository: "acme/hidden" }),
    hidden,
  );
  translated("hidden", hidden);

  const readOnly = await message("readOnly", api.change(comment("acme/readonly")));
  check(
    "a repository that refuses a change is named in the error",
    readOnly === sourceText("error.workflow.githubNoWriteRepository", { repository: "acme/readonly" }),
    readOnly,
  );
  translated("readOnly", readOnly);

  const readRefused = await message("readRefused", api.options("acme/readonly"));
  check(
    "a refused read of the options says that the app cannot read the repository",
    readRefused === sourceText("error.workflow.githubNoReadRepository", { repository: "acme/readonly" }),
    readRefused,
  );
  translated("readRefused", readRefused);

  const eventsRefused = await message("eventsRefused", api.recentEvents("acme/readonly", "issue.opened"));
  check(
    "a refused read of the recent events says that the app cannot read the repository",
    eventsRefused === sourceText("error.workflow.githubNoReadRepository", { repository: "acme/readonly" }),
    eventsRefused,
  );

  const userOnly = await message("userOnly", api.change(comment("acme/user-only")));
  check(
    "a repository where the app has no token is named in the error",
    userOnly === sourceText("error.workflow.githubNoWriteRepository", { repository: "acme/user-only" }),
    userOnly,
  );

  const userHidden = await message("userHidden", api.options("acme/user-only"));
  check(
    "a 404 on the user's token names the user's account, not the app",
    userHidden === sourceText("error.workflow.githubUserNoAccessRepository", { repository: "acme/user-only" }),
    userHidden,
  );
  translated("userHidden", userHidden);

  const userItem = await message("userItem", api.recentEvents("acme/user-only", "pr.reviewSubmitted"));
  check(
    "a missing pull request on the user's token names the item and the user's account",
    userItem === sourceText("error.workflow.githubUserNoItem", { repository: "acme/user-only", number: "7" }),
    userItem,
  );
  translated("userItem", userItem);

  const missingItem = await message("missingItem", api.change(comment("acme/app", 404)));
  check(
    "a missing issue names the item, not only the repository",
    missingItem === sourceText("error.workflow.githubNoItem", { repository: "acme/app", number: "404" }),
    missingItem,
  );
  translated("missingItem", missingItem);

  const busyRead = await message("busyRead", api.options("acme/busy"));
  const busyChange = await message("busyChange", api.change(comment("acme/busy")));
  const rateLimited = sourceText("error.workflow.githubRateLimited");
  check("a secondary rate limit on a read is a rate limit", busyRead === rateLimited, busyRead);
  check("a secondary rate limit on a change is a rate limit", busyChange === rateLimited, busyChange);
  translated("busy", busyRead);

  const files = await Effect.runPromise(
    api.attachFiles({
      ...comment("acme/user-only"),
      files: {
        folder: "run",
        files: [{ name: "a.png", url: "https://cdn.example/a.png", contentType: "image/png", size: 1 }],
      },
    }),
  );
  check(
    "a file of a change without the app's token keeps its own link",
    files.files === null && files.body.includes("https://cdn.example/a.png"),
    files.body,
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
