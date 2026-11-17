// Checks how the account service picks the repositories of a GitHub route ticket, with the real
// `GitHubInstallationTokens` and a fake GitHub API: a named repository is in the ticket; an owner adds each
// repository of its installation that is not archived or excluded; an owner that the sign-in cannot see
// adds nothing;
// the named repositories come first and the ticket stops at `GITHUB_ROUTE_REPOSITORIES_LIMIT`; a request
// without owners reads no installation that it does not need. No network is used.
//
// Run: bun scripts/github-route-owners-e2e.ts
// Writes .openbot-build/github-route-owners-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { GITHUB_ROUTE_REPOSITORIES_LIMIT } from "@openbot/contracts/signal-protocol/github-route";
import { Effect } from "effect";
import { GitHubInstallationTokens } from "../apps/auth-api/src/server/github-installation-tokens";

const OUT = resolve(import.meta.dirname, "../.openbot-build/github-route-owners-e2e");
const APP_ID = 7;

interface Report {
  checks: string[];
  requests: string[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], requests: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

interface FakeRepository {
  id: number;
  full_name: string;
  archived?: boolean;
}

/** The installations of the App that the signed-in user can see, by id, with their repositories. */
const installations = new Map<number, { login: string; repositories: FakeRepository[] }>([
  [
    1,
    {
      login: "octo",
      repositories: [
        { id: 11, full_name: "octo/app" },
        { id: 12, full_name: "octo/old", archived: true },
        { id: 13, full_name: "octo/api" },
      ],
    },
  ],
  [
    2,
    {
      login: "ana",
      repositories: [{ id: 21, full_name: "ana/notes" }],
    },
  ],
  [
    3,
    {
      login: "big",
      repositories: Array.from({ length: 250 }, (_, index) => ({ id: 1_000 + index, full_name: `big/repo-${index}` })),
    },
  ],
]);

const json = (body: unknown) => new Response(JSON.stringify(body), { headers: { "content-type": "application/json" } });

const fakeGitHub = async (input: string): Promise<Response> => {
  const url = new URL(input);
  report.requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === "/app") return json({ id: APP_ID });
  if (url.pathname === "/user/installations")
    return json({
      installations: [...installations].map(([id, installation]) => ({
        id,
        app_id: APP_ID,
        account: { login: installation.login },
        events: ["issues", "issue_comment", "pull_request", "pull_request_review", "check_suite"],
      })),
    });
  const match = /^\/user\/installations\/(\d+)\/repositories$/u.exec(url.pathname);
  const installation = match ? installations.get(Number(match[1])) : undefined;
  if (installation) {
    const page = Number(url.searchParams.get("page") ?? "1");
    const size = Number(url.searchParams.get("per_page") ?? "100");
    return json({
      total_count: installation.repositories.length,
      repositories: installation.repositories.slice((page - 1) * size, page * size),
    });
  }
  return new Response("{}", { status: 404 });
};

try {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const tokens = new GitHubInstallationTokens({
    clientId: "Iv1.test",
    privateKey: privateKey.export({ type: "pkcs8", format: "pem" }).toString(),
    fetch: (input) => fakeGitHub(input),
  });
  const routes = (names: string[], owners: string[], excluded: string[] = []) =>
    Effect.runPromise(tokens.repositoryRoutes("ghu_test", names, owners, excluded));
  const names = (list: { fullName: string }[]) => list.map((route) => route.fullName);

  const named = await routes(["ana/notes"], []);
  check("a named repository is in the ticket", names(named).join() === "ana/notes", named);
  report.requests = [];
  await routes(["octo/app"], []);
  check(
    "a request without owners stops reading when it found its names",
    !report.requests.some(
      (path) => path.startsWith("/user/installations/2/") || path.startsWith("/user/installations/3/"),
    ),
    report.requests,
  );

  const owned = await routes([], ["OCTO"]);
  check(
    "an owner adds each repository of its installation that is not archived",
    names(owned).sort().join() === "octo/api,octo/app" &&
      owned.every((route) => route.installationId === 1 && route.events),
    owned,
  );

  const left = await routes([], ["octo"], ["OCTO/api"]);
  check("an excluded repository of an owner is not in the ticket", names(left).join() === "octo/app", left);
  const leftNamed = await routes(["octo/api"], ["octo"], ["octo/api"]);
  check(
    "a named repository stays in the ticket when the owner excludes it",
    names(leftNamed).sort().join() === "octo/api,octo/app",
    leftNamed,
  );

  const unknown = await routes([], ["nobody"]);
  check("an owner that the sign-in cannot see adds nothing", unknown.length === 0, unknown);

  const both = await routes(["octo/app"], ["octo"]);
  check(
    "a named repository of a watched owner is in the ticket once",
    names(both).sort().join() === "octo/api,octo/app",
    both,
  );

  const bounded = await routes(["ana/notes"], ["big"]);
  check(
    "the named repositories come first and the ticket stops at the route limit",
    bounded.length === GITHUB_ROUTE_REPOSITORIES_LIMIT && bounded[0]?.fullName === "ana/notes",
    { length: bounded.length, first: bounded[0] },
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
