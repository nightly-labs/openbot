// Checks that an HTTPS sign-out and an admin's session end close every part of that team session,
// the live browser view too (plan 009). Runs the real Team API `routeTeam` handler with recording
// stand-ins for the store, the remote screen and the browser view, on real Node request objects.
// `bun scripts/team-session-end-e2e.ts`. Writes .openbot-build/team-session-end-e2e/report.json.
import { mkdirSync, writeFileSync } from "node:fs";
import { IncomingMessage, ServerResponse } from "node:http";
import { Socket } from "node:net";
import { join, resolve } from "node:path";
import type { TeamMemberSummary, TeamSessionSummary } from "@openbot/contracts/ipc";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import { Effect } from "effect";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeTeam, type TeamRouteDependencies } from "../src/main/team-api/route-team";

const OUT = resolve(import.meta.dirname, "../.openbot-build/team-session-end-e2e");
const ORIGIN = "https://host.test";

const checks: { name: string; passed: boolean; detail?: unknown }[] = [];
function check(name: string, passed: boolean, detail?: unknown) {
  checks.push({ name, passed, ...(detail === undefined ? {} : { detail }) });
}
const report: { passed: boolean; checks: typeof checks; error?: string } = { passed: false, checks };

const OWNER: TeamMemberSummary = {
  id: "member-a",
  username: "owner",
  email: null,
  name: "Owner",
  role: "owner",
  createdAt: "2026-10-17T00:00:00.000Z",
  disabled: false,
};
const MEMBER: TeamMemberSummary = { ...OWNER, id: "member-b", username: "member", name: "Member", role: "member" };
const SESSION_B: TeamSessionSummary = {
  id: "session-b",
  memberId: MEMBER.id,
  username: MEMBER.username,
  createdAt: "2026-10-17T00:00:00.000Z",
  expiresAt: "2026-10-18T00:00:00.000Z",
};

/** The calls that each stand-in got, by name. */
function recorder() {
  const calls: Record<string, string[]> = {};
  const record = (name: string, value: string) => {
    calls[name] = [...(calls[name] ?? []), value];
    return Effect.void;
  };
  const unused = () => Effect.die(new Error("Not used by this check."));
  const store: TeamRouteDependencies["store"] = {
    logout: (token) => record("store.logout", token),
    changePassword: unused,
    resolveLogo: () => null,
    listMembers: () => [OWNER, MEMBER],
    updateMember: unused,
    removeMember: unused,
    listInvites: () => [],
    revokeInvite: unused,
    listSessions: () => [SESSION_B],
    revokeSession: (sessionId) => record("store.revokeSession", sessionId),
  };
  const remoteScreen: NonNullable<TeamRouteDependencies["remoteScreen"]> = {
    revokeTeamSession: (sessionId) => record("remoteScreen.revokeTeamSession", sessionId),
    revokeMember: (memberId) => record("remoteScreen.revokeMember", memberId),
  };
  const browserView: NonNullable<TeamRouteDependencies["browserView"]> = {
    revokeTeamSession: (sessionId) => record("browserView.revokeTeamSession", sessionId),
  };
  return { calls, store, remoteScreen, browserView };
}

/** Runs one request through `routeTeam` as the owner on session A, and returns the status it answered. */
async function send(method: string, path: string, dependencies: TeamRouteDependencies) {
  const request = new IncomingMessage(new Socket());
  const response = new ServerResponse(request);
  const statuses: number[] = [];
  const context: TeamApiRequestContext = {
    request,
    response,
    method,
    url: new URL(path, ORIGIN),
    protocol: 3,
    capabilities: new Set(),
    member: OWNER,
    token: "token-a",
    agentLevel: () => "manage",
    sessionId: "session-a",
    sessionExpiresAt: "2026-10-18T00:00:00.000Z",
    json: (status) => {
      statuses.push(status);
      return "handled";
    },
    empty: (status) => {
      statuses.push(status);
      return "handled";
    },
  };
  const outcome = await routeTeam(context, dependencies);
  return { outcome, status: statuses[0] ?? null };
}

const routes = {
  getPresence: () => ({ serverId: null, members: [], updatedAt: "2026-10-17T00:00:00.000Z" }),
  refreshPresence: () => {},
};

try {
  {
    const { calls, store, remoteScreen, browserView } = recorder();
    const result = await send("POST", TEAM_API_ROUTES.auth.logout, { store, remoteScreen, browserView, ...routes });
    check("a sign-out answers 204", result.status === 204, result);
    check("a sign-out ends the store session", calls["store.logout"]?.join() === "token-a", calls);
    check(
      "a sign-out closes the remote screen of the session",
      calls["remoteScreen.revokeTeamSession"]?.join() === "session-a",
      calls,
    );
    check(
      "a sign-out closes the browser view of the session",
      calls["browserView.revokeTeamSession"]?.join() === "session-a",
      calls,
    );
  }
  {
    const { calls, store, remoteScreen, browserView } = recorder();
    const result = await send("DELETE", TEAM_API_ROUTES.team.session(SESSION_B.id), {
      store,
      remoteScreen,
      browserView,
      ...routes,
    });
    check("an owner who ends a session gets 204", result.status === 204, result);
    check("a session end removes the store session", calls["store.revokeSession"]?.join() === "session-b", calls);
    check(
      "a session end closes the remote screen of the session",
      calls["remoteScreen.revokeTeamSession"]?.join() === "session-b",
      calls,
    );
    check(
      "a session end closes the browser view of the session",
      calls["browserView.revokeTeamSession"]?.join() === "session-b",
      calls,
    );
  }
  {
    const { calls, store, remoteScreen } = recorder();
    const result = await send("DELETE", TEAM_API_ROUTES.team.session(SESSION_B.id), { store, remoteScreen, ...routes });
    check("a session end with no browser view still answers 204", result.status === 204, { result, calls });
  }
  report.passed = checks.every((entry) => entry.passed);
} catch (error) {
  report.error = error instanceof Error ? (error.stack ?? error.message) : String(error);
} finally {
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  for (const entry of checks) process.stdout.write(`${entry.passed ? "PASS" : "FAIL"} ${entry.name}\n`);
  if (report.error) process.stdout.write(`${report.error}\n`);
  process.stdout.write(`Report: ${join(OUT, "report.json")}\n`);
  if (!report.passed) process.exitCode = 1;
}
