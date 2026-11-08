// Runs the production optional HTTP route and shared remote adapters with isolated SQLite.
// Authentication is supplied by the fixture. No live host or account is used.
import assert from "node:assert/strict";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { AgentAccessLevel, EventRoutineOwner, TeamRole } from "@openbot/contracts/ipc";
import { CHANNEL_ROUTES } from "@openbot/contracts/team-protocol/channels-v1";
import { teamCapabilitiesForProtocol } from "@openbot/contracts/team-protocol/current";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import {
  decodeRoutineStatuses,
  ROUTINE_STATUS_CAPABILITY,
  ROUTINE_STATUS_ROUTES,
} from "@openbot/contracts/team-protocol/routine-status-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import { TEAM_PROTOCOL_VERSION_HEADER } from "@openbot/contracts/team-protocol/v1";
import {
  readRoutineStatuses,
  saveRoutineStatus,
  type TeamApiRequest,
  teamAgentRoutinesApi,
  teamChannelsApi,
} from "@openbot/team-client/team-api-requests";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { HttpError } from "../src/main/team-api/http-error";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeAgentRoutines } from "../src/main/team-api/route-agent-routines";
import { routeRoutineStatus } from "../src/main/team-api/route-routine-status";

const out = resolve(import.meta.dirname, "../.openbot-build/routine-silent-status-api-e2e");
const root = await mkdtemp(join(tmpdir(), "openbot-routine-status-api-"));
const database = new OpenBotDatabase(join(root, "state"));
const agents = new AgentStore(join(root, "state"), join(root, "home"), database);
const routines = new AgentRoutineStore(database);
const channels = new ChannelRoutineStore(database);
const checks: string[] = [];
let passed = false;
let role: TeamRole = "member";
let level: AgentAccessLevel = "manage";
let enabled = true;
const hidden = new Set<string>();
const ownerStore = (owner: EventRoutineOwner) => (owner.kind === "agent" ? routines : channels);
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  const context: TeamApiRequestContext = {
    request,
    response,
    url,
    method: request.method ?? "GET",
    protocol: 9,
    capabilities: new Set(enabled ? [ROUTINE_STATUS_CAPABILITY] : []),
    member: {
      id: "fixture",
      username: "fixture",
      email: null,
      name: null,
      role,
      createdAt: "2026-11-01",
      disabled: false,
    },
    token: "fixture",
    sessionId: "fixture",
    sessionExpiresAt: "2099-01-01",
    agentLevel: () => level,
    json(status, value) {
      const codec = teamSideRouteCodec(url.pathname);
      const encoded = codec
        ? JSON.stringify(codec.response(url.pathname, status, value))
        : teamHttpCodec(9).encodeResponse(request.method ?? "GET", url.pathname, status, value, {});
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(encoded);
      return "handled";
    },
    empty(status) {
      response.writeHead(status).end();
      return "handled";
    },
  };
  try {
    const result = await routeRoutineStatus(
      context,
      {
        listAgents: () => agents.list(),
        updateRoutine: (input) => routines.update(input),
      },
      {
        ownerExists: (owner) =>
          owner.kind === "agent"
            ? agents.list().some((agent) => agent.id === owner.id)
            : owner.id === "channel-fixture",
        list: (owner) => ownerStore(owner).listRecords(owner.id),
        get: (owner, id) => ownerStore(owner).getRecord(owner.id, id),
        save: (owner, id, input) => ownerStore(owner).saveRecord(owner.id, id, input),
      },
      hidden,
    );
    if (result === "handled") return;
    const target = url.pathname.match(/^\/v1\/agents\/([^/]+)\/(routines.*)$/u);
    if (target?.[1] && target[2]) {
      const routed = await routeAgentRoutines(
        context,
        { agentId: target[1], action: target[2] },
        {
          agents: {
            listRoutines: (id) => routines.list(id),
            createRoutine: (input) => routines.create(input),
            updateRoutine: (input) => routines.update(input),
            listRoutineRuns: (input) => routines.listRuns(input.agentId, input.routineId),
            deleteRoutine: () => Effect.die("Delete is outside this fixture."),
            testRoutine: () => Effect.die("Test is outside this fixture."),
          },
        },
      );
      if (routed === "handled") return;
    }
    if (url.pathname === CHANNEL_ROUTES.routines) {
      context.json(200, channels.list("channel-fixture"));
      return;
    }
    response.writeHead(404).end();
  } catch (error) {
    response.writeHead(error instanceof HttpError ? error.status : 500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
  }
});
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({
      name: "API fixture",
      description: "Synthetic routine fixture",
      avatarSeed: "fixture",
      avatarHue: null,
    }),
  );
  database.connection
    .prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)")
    .run("channel-fixture", "{}");
  const input = {
    name: "Fixture",
    instruction: "Keep the report.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "hourly" as const, minute: 0 },
  };
  const routine = routines.create({ ...input, agentId: agent.id });
  const channel = channels.create({ ...input, channelId: "channel-fixture" });
  const owner = { kind: "agent", id: agent.id } as const;
  const channelOwner = { kind: "channel", id: "channel-fixture" } as const;
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const post = (path: string, body: unknown) =>
    fetch(base + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const request: TeamApiRequest = async (method, path, decode, body) => {
    const codec = teamSideRouteCodec(path);
    const encoded =
      body === undefined
        ? undefined
        : codec
          ? JSON.stringify(codec.request(path, body))
          : teamHttpCodec(9).encodeRequest(method, path, body, {});
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json", [TEAM_PROTOCOL_VERSION_HEADER]: "9" },
      body: encoded,
    });
    const value = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decode(
      codec
        ? codec.response(path, response.status, value)
        : teamHttpCodec(9).decodeResponse(method, path, response.status, value),
    );
  };
  const remote = teamAgentRoutinesApi(
    request,
    () => false,
    () => true,
  );
  const remoteCreated = await remote.createRoutine({ ...input, agentId: agent.id, silent: true });
  assert.equal(remoteCreated.silent, true);
  assert.equal(
    (await remote.updateRoutine({ agentId: agent.id, routineId: remoteCreated.id, name: "Remote edit" })).silent,
    true,
  );
  assert.equal(
    (await remote.updateRoutine({ agentId: agent.id, routineId: remoteCreated.id, silent: false })).silent,
    false,
  );
  assert.equal((await remote.listRoutines(agent.id)).find((routine) => routine.id === remoteCreated.id)?.silent, false);
  checks.push(
    "The production remote agent API creates and edits through released routes plus the new capability, including a preference-only edit.",
  );
  const next = routines.get(agent.id, routine.id)?.trigger.nextRunAt;
  assert.equal((await saveRoutineStatus(request, owner, routine, true, true)).silent, true);
  assert.equal(routines.get(agent.id, routine.id)?.silent, true);
  assert.equal(routines.get(agent.id, routine.id)?.trigger.nextRunAt, next);
  assert.equal((await readRoutineStatuses(request, owner, [{ id: routine.id }], true))[0]?.silent, true);
  const renamed = routines.update({ agentId: agent.id, routineId: routine.id, name: "Renamed" });
  assert.equal((await saveRoutineStatus(request, owner, { id: renamed.id }, undefined, true)).silent, true);
  assert.equal((await saveRoutineStatus(request, owner, routine, false, true)).silent, false);
  checks.push(
    "A member with manage access can create/read/change the preference; omitted updates preserve it and the schedule stays unchanged.",
  );
  for (const silent of [null, 0, "true", {}, []])
    assert.equal((await post(ROUTINE_STATUS_ROUTES.set, { owner, routineId: routine.id, silent })).status, 400);
  assert.equal(routines.get(agent.id, routine.id)?.silent, false);
  checks.push("The production HTTP decoder rejects invalid flags including null before storage.");
  level = "chat";
  assert.equal((await post(ROUTINE_STATUS_ROUTES.list, { owner })).status, 200);
  assert.equal((await post(ROUTINE_STATUS_ROUTES.set, { owner, routineId: routine.id, silent: true })).status, 403);
  level = "none";
  assert.equal((await post(ROUTINE_STATUS_ROUTES.list, { owner })).status, 404);
  level = "manage";
  hidden.add(agent.id);
  assert.equal((await post(ROUTINE_STATUS_ROUTES.list, { owner })).status, 404);
  hidden.clear();
  assert.equal((await post(ROUTINE_STATUS_ROUTES.set, { owner, routineId: "deleted", silent: true })).status, 404);
  checks.push("Read/manage permissions, hidden agents, and deleted routines keep their existing boundaries.");
  assert.equal((await post(ROUTINE_STATUS_ROUTES.list, { owner: channelOwner })).status, 403);
  role = "admin";
  assert.equal(
    (
      await teamChannelsApi(request, () => true).updateChannelRoutine({
        channelId: channel.channelId,
        routineId: channel.id,
        silent: true,
      })
    ).silent,
    true,
  );
  assert.equal((await saveRoutineStatus(request, channelOwner, channel, true, true)).silent, true);
  assert.equal(channels.update({ channelId: channel.channelId, routineId: channel.id, name: "Renamed" }).silent, true);
  assert.equal((await readRoutineStatuses(request, channelOwner, [channel], true))[0]?.silent, true);
  const webhook = routines.saveRecord(agent.id, undefined, {
    ...input,
    silent: true,
    trigger: { kind: "webhook", eventType: null, filters: [], secretCiphertext: "fixture-ciphertext" },
  });
  const before = database.connection
    .prepare(
      "SELECT route_id, secret_ciphertext, event_type, filters_json FROM projection_routine_webhooks WHERE routine_id=?",
    )
    .get(webhook.id);
  assert.equal((await saveRoutineStatus(request, owner, webhook, false, true)).silent, false);
  assert.deepEqual(
    database.connection
      .prepare(
        "SELECT route_id, secret_ciphertext, event_type, filters_json FROM projection_routine_webhooks WHERE routine_id=?",
      )
      .get(webhook.id),
    before,
  );
  role = "member";
  const list = await request("POST", ROUTINE_STATUS_ROUTES.list, decodeRoutineStatuses, { owner });
  assert.equal(
    list.some((entry) => entry.routineId === webhook.id),
    false,
  );
  assert.equal((await post(ROUTINE_STATUS_ROUTES.set, { owner, routineId: webhook.id, silent: true })).status, 404);
  checks.push(
    "Channel preferences require administration; webhook route identity and secret stay unchanged and members cannot access them.",
  );
  enabled = false;
  assert.equal((await post(ROUTINE_STATUS_ROUTES.list, { owner })).status, 400);
  assert.equal((await saveRoutineStatus(request, owner, routine, true, true, true)).silent, false);
  assert.equal((await saveRoutineStatus(request, owner, { id: routine.id }, undefined, true, true)).id, routine.id);
  assert.equal((await saveRoutineStatus(request, owner, routine, undefined, false)).id, routine.id);
  await assert.rejects(saveRoutineStatus(request, owner, routine, true, true), /HTTP 400/u);
  for (let version = 1; version < 9; version += 1)
    assert.equal(teamCapabilitiesForProtocol(version).includes(ROUTINE_STATUS_CAPABILITY), false);
  assert.equal(teamCapabilitiesForProtocol(9).includes(ROUTINE_STATUS_CAPABILITY), true);
  checks.push(
    "Unsupported hosts hide the capability; a failed post-create save retains the created ID, while a failed edit reports an error.",
  );
  passed = true;
} finally {
  if (server.listening)
    await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
  database.close();
  await mkdir(out, { recursive: true });
  await writeFile(
    join(out, "report.json"),
    JSON.stringify(
      {
        passed,
        checks,
        scope:
          "Production HTTP route, wire codecs and shared adapters. Fixture authentication; no full Team API peer or WebRTC connection.",
      },
      null,
      2,
    ),
  );
  await rm(root, { recursive: true, force: true });
}
