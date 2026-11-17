// Checks the GitHub relay of the host with a fake ingress socket and a fake account service: a watch
// longer than the route holds is cut to the route limits before it goes out, so the account service does
// not refuse the whole route; a new repository of a watched owner reconnects the socket once; a repository
// that the new ticket still does not name does not reconnect it again until the retry time ends; an
// excluded repository does not reconnect it. No network is used.
//
// Run: bun scripts/github-relay-owners-e2e.ts
// Writes .openbot-build/github-relay-owners-e2e/report.json and exits non-zero on a failure.
import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  GITHUB_ROUTE_OWNERS_LIMIT,
  GITHUB_ROUTE_REPOSITORIES_LIMIT,
} from "@openbot/contracts/signal-protocol/github-route";
import { Effect } from "effect";
import type { GitHubWatch } from "../src/backend/workflows/github-matching";
import { GitHubRelay } from "../src/main/github-relay";

const OUT = resolve(import.meta.dirname, "../.openbot-build/github-relay-owners-e2e");
const HOUR = 60 * 60_000;

interface Report {
  checks: string[];
  sent: GitHubWatch[];
  passed: boolean;
  failure?: string;
}

const report: Report = { checks: [], sent: [], passed: false };
const check = (name: string, ok: boolean, detail?: unknown) => {
  assert.ok(ok, `${name}${detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`);
  report.checks.push(name);
};

try {
  let reconnects = 0;
  /** The repositories that the fake account service names in the next ticket. */
  let routed: string[] = [];
  const trimmed: { repositories: number; owners: number; excluded: number }[] = [];
  const relay = new GitHubRelay({
    account: {
      issueGitHubRoute: (_hostId, _token, watch) =>
        Effect.sync(() => {
          report.sent.push(watch);
          return {
            ticket: "ticket",
            repositories: routed.map((fullName, index) => ({
              id: index + 1,
              installationId: 1,
              fullName,
              events: true,
            })),
          };
        }),
    },
    githubToken: () => Effect.succeed("ghu_test"),
    ingress: () => ({
      acquireGitHub: () => () => {},
      reconnect: () => {
        reconnects += 1;
      },
      githubReady: () => true,
      handleGitHub: () => {},
    }),
    onTrimmed: (dropped) => trimmed.push(dropped),
  });

  relay.setWatch({
    repositories: Array.from({ length: GITHUB_ROUTE_REPOSITORIES_LIMIT + 20 }, (_, index) => `acme/repo-${index}`),
    owners: Array.from({ length: GITHUB_ROUTE_OWNERS_LIMIT + 3 }, (_, index) => `owner-${index}`),
    excluded: [],
  });
  await Effect.runPromise(relay.issueRoute("host"));
  const longSent = report.sent.at(-1);
  check(
    "a long watch is cut to the route limits before it goes out",
    longSent?.repositories.length === GITHUB_ROUTE_REPOSITORIES_LIMIT &&
      longSent.owners.length === GITHUB_ROUTE_OWNERS_LIMIT &&
      trimmed.at(-1)?.repositories === 20 &&
      trimmed.at(-1)?.owners === 3,
    { repositories: longSent?.repositories.length, owners: longSent?.owners.length, trimmed },
  );

  routed = ["octo/app"];
  relay.setWatch({ repositories: [], owners: ["Octo"], excluded: ["octo/skip"] });
  await Effect.runPromise(relay.issueRoute("host"));
  check(
    "the watch goes out with its owner and its excluded repository",
    report.sent.at(-1)?.owners.join() === "octo" && report.sent.at(-1)?.excluded.join() === "octo/skip",
    report.sent.at(-1),
  );

  const start = 1_000_000;
  const before = reconnects;
  relay.noticeRepositories(["octo/app", "octo/skip", "other/repo"], start);
  check("named, excluded and other repositories do not reconnect the socket", reconnects === before, reconnects);
  relay.noticeRepositories(["octo/app", "octo/new"], start);
  check("a new repository of a watched owner reconnects the socket once", reconnects === before + 1, reconnects);
  // The account service still leaves it out, for example while the App does not reach it.
  await Effect.runPromise(relay.issueRoute("host"));
  relay.noticeRepositories(["octo/new"], start + HOUR);
  check("it does not reconnect again before the retry time ends", reconnects === before + 1, reconnects);
  relay.noticeRepositories(["octo/new"], start + 7 * HOUR);
  check("it asks again after the retry time", reconnects === before + 2, reconnects);
  routed = ["octo/app", "octo/new"];
  await Effect.runPromise(relay.issueRoute("host"));
  relay.noticeRepositories(["octo/new"], start + 20 * HOUR);
  check("a repository that the ticket names does not reconnect", reconnects === before + 2, reconnects);

  relay.stop();
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
