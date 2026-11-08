import assert from "node:assert/strict";
import { once } from "node:events";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { CHANNEL_CHATS_CAPABILITY, type EventRoutineOwner } from "@openbot/contracts/ipc";
import { EVENTS_CAPABILITY } from "@openbot/contracts/team-protocol/events-v1";
import { teamHttpCodec } from "@openbot/contracts/team-protocol/http-codecs";
import { ROUTINE_STATUS_CAPABILITY, ROUTINE_STATUS_ROUTES } from "@openbot/contracts/team-protocol/routine-status-v1";
import { teamSideRouteCodec } from "@openbot/contracts/team-protocol/side-routes";
import type { TeamApiRequest } from "@openbot/team-client/team-api-requests";
import { type BunPlugin, build } from "bun";
import { Effect } from "effect";
import { AgentRoutineStore } from "../src/backend/agent-routine-store";
import { AgentStore } from "../src/backend/agent-store";
import { ChannelImages } from "../src/backend/channel-images";
import { ChannelRoutineStore } from "../src/backend/channel-routine-store";
import { ChannelService } from "../src/backend/channel-service";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { HttpError } from "../src/main/team-api/http-error";
import type { TeamApiRequestContext } from "../src/main/team-api/request-context";
import { routeAgentRoutines } from "../src/main/team-api/route-agent-routines";
import { routeChannels } from "../src/main/team-api/route-channels";
import { routeEvents } from "../src/main/team-api/route-events";
import { routeRoutineStatus } from "../src/main/team-api/route-routine-status";

const mobilePlugin: BunPlugin = {
  name: "mobile-synthetic-native-boundary",
  setup(build) {
    build.onResolve({ filter: /^@\// }, ({ path }) => {
      const base = resolve(import.meta.dirname, "../apps/mobile/src", path.slice(2));
      return { path: [base, `${base}.ts`, `${base}.tsx`].find(existsSync) ?? base };
    });
    build.onResolve({ filter: /^expo-crypto$/ }, () => ({ path: "crypto", namespace: "silent-fixture" }));
    build.onResolve({ filter: /^expo-file-system$/ }, () => ({ path: "files", namespace: "silent-fixture" }));
    build.onResolve({ filter: /^react-native$/ }, () => ({ path: "native", namespace: "silent-fixture" }));
    build.onLoad({ filter: /.*/, namespace: "silent-fixture" }, ({ path }) => ({
      loader: "js",
      contents:
        path === "crypto"
          ? "export const getRandomBytesAsync = () => { throw new Error('Native crypto is outside this fixture.'); };"
          : path === "native"
            ? "export const Platform = { OS: 'web' }; export const NativeModules = {}; export const NativeEventEmitter = class {};"
            : "export class Directory {} export class File {} export const Paths = {};",
    }));
    build.onLoad({ filter: /\/shared\/lib\/text(?:\.tsx?)?$/ }, () => ({
      loader: "js",
      contents: "export const currentText = () => ({ t: key => key });",
    }));
    build.onLoad({ filter: /\/shared\/lib\/format-updated-at(?:\.tsx?)?$/ }, () => ({
      loader: "js",
      contents: "export const formatUpdatedAt = value => value;",
    }));
  },
};

const out = resolve(import.meta.dirname, "../.openbot-build/routine-silent-mobile-e2e");
await mkdir(out, { recursive: true });
const bundle = await build({
  entrypoints: [resolve(import.meta.dirname, "../apps/mobile/src/features/workspace/context/host-request-actions.ts")],
  target: "bun",
  format: "esm",
  external: ["@openbot/*", "effect", "@tanstack/*"],
  plugins: [mobilePlugin],
});
assert.ok(bundle.success, bundle.logs.map(String).join("\n"));
const bundled = bundle.outputs[0];
assert.ok(bundled);
const bundledPath = join(out, "mobile-actions.mjs");
await writeFile(bundledPath, await bundled.text());
const { createHostRequestActions } = await import(bundledPath);
const { QueryClient } = await import("@tanstack/react-query");
const { MobileChannelStore } = await import("../apps/mobile/src/features/channels/model/channel-store");
const { queryKeys } = await import("../apps/mobile/src/features/workspace/model/query-keys");
const root = await mkdtemp(join(tmpdir(), "openbot-silent-mobile-"));
const database = new OpenBotDatabase(join(root, "state"));
const agents = new AgentStore(join(root, "state"), join(root, "home"), database);
const routines = new AgentRoutineStore(database);
const channelRoutines = new ChannelRoutineStore(database);
const requests: { method: string; path: string; body: unknown; status: number }[] = [];
const checks: { name: string; passed: boolean; actual: unknown }[] = [];
let enabled = true;
let failStatus = false;
let error: string | undefined;
const unused = () => Effect.die("This event operation is outside the fixture.");
const unusedSync = () => {
  throw new Error("This channel operation is outside the fixture.");
};
const channels = new ChannelService(
  database,
  new MailboxStore(join(root, "state"), agents.sharedRoot, database),
  new ChannelImages(join(root, "images")),
  {
    agents: () => agents.list(),
    generate: unused,
    schedule: () => {},
    interrupt: unused,
    busy: () => false,
    changed: () => {},
    error: unusedSync,
  },
);
const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? "/", "http://fixture.invalid");
  const context: TeamApiRequestContext = {
    request,
    response,
    url,
    method: request.method ?? "GET",
    protocol: 9,
    capabilities: new Set([
      EVENTS_CAPABILITY,
      CHANNEL_CHATS_CAPABILITY,
      ...(enabled ? [ROUTINE_STATUS_CAPABILITY] : []),
    ]),
    member: {
      id: "fixture",
      username: "fixture",
      email: null,
      name: null,
      role: "member",
      createdAt: "2026-11-01",
      disabled: false,
    },
    token: "fixture",
    sessionId: "fixture",
    sessionExpiresAt: "2099-01-01",
    agentLevel: () => "manage",
    json(status, value) {
      const codec = teamSideRouteCodec(url.pathname);
      response.writeHead(status, { "Content-Type": "application/json" });
      response.end(
        codec
          ? JSON.stringify(codec.response(url.pathname, status, value))
          : teamHttpCodec(9).encodeResponse(request.method ?? "GET", url.pathname, status, value, {}),
      );
      return "handled";
    },
    empty(status) {
      response.writeHead(status).end();
      return "handled";
    },
  };
  try {
    const ownerStore = (owner: EventRoutineOwner) => (owner.kind === "agent" ? routines : channelRoutines);
    const records = {
      ownerExists: (owner: EventRoutineOwner) =>
        owner.kind === "agent" ? agents.list().some((agent) => agent.id === owner.id) : channels.store.exists(owner.id),
      list: (owner: EventRoutineOwner) => ownerStore(owner).listRecords(owner.id),
      get: (owner: EventRoutineOwner, id: string) => ownerStore(owner).getRecord(owner.id, id),
      save: (owner: EventRoutineOwner, id: string, input: Parameters<AgentRoutineStore["saveRecord"]>[2]) =>
        ownerStore(owner).saveRecord(owner.id, id, input),
    };
    if (
      (await routeRoutineStatus(
        context,
        { listAgents: () => agents.list(), updateRoutine: (input) => routines.update(input) },
        records,
        new Set(),
        channels,
      )) === "handled"
    )
      return;
    if (
      (await routeChannels(context, channels, {
        listChannelMemories: unusedSync,
        createChannelMemory: unusedSync,
        updateChannelMemory: unusedSync,
        deleteChannelMemory: unusedSync,
        clearChannelMemories: unusedSync,
        listChannelRoutines: (id) => channelRoutines.list(id),
        createChannelRoutine: (input) => channelRoutines.create(input),
        updateChannelRoutine: (input) => channelRoutines.update(input),
        deleteChannelRoutine: unusedSync,
        testChannelRoutine: unused,
        listChannelRoutineRuns: (input) => channelRoutines.listRuns(input.channelId, input.routineId),
      })) === "handled"
    )
      return;
    if (
      (await routeEvents(context, {
        events: {
          getStatus: unused,
          listRoutines: unused,
          saveRoutine: unused,
          deleteRoutine: unused,
          testRoutine: unused,
          rotateSecret: unused,
          setSecret: unused,
          sendTestEvent: unused,
          listActivity: unused,
          listRoutineRuns: unused,
        },
      })) === "handled"
    )
      return;
    const target = url.pathname.match(/^\/v1\/agents\/([^/]+)\/(routines.*)$/u);
    if (
      target?.[1] &&
      target[2] &&
      (await routeAgentRoutines(
        context,
        { agentId: target[1], action: target[2] },
        {
          agents: {
            listRoutines: (id) => routines.list(id),
            createRoutine: (input) => routines.create(input),
            updateRoutine: (input) => routines.update(input),
            listRoutineRuns: (input) => routines.listRuns(input.agentId, input.routineId),
            deleteRoutine: unused,
            testRoutine: unused,
          },
        },
      )) === "handled"
    )
      return;
    response.writeHead(404).end();
  } catch (cause) {
    response.writeHead(cause instanceof HttpError ? cause.status : 500, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: cause instanceof Error ? cause.message : String(cause) }));
  }
});
const client = new QueryClient();
try {
  await runCauseEffect(agents.initialize());
  const agent = await runCauseEffect(
    agents.createAgent({ name: "Mobile fixture", description: "Synthetic", avatarSeed: "fixture", avatarHue: null }),
  );
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const base = `http://127.0.0.1:${address.port}`;
  const request: TeamApiRequest = async (method, path, decode, body) => {
    if (failStatus && path === ROUTINE_STATUS_ROUTES.set) throw new Error("Synthetic preference failure.");
    const codec = teamSideRouteCodec(path);
    const encoded =
      body === undefined
        ? undefined
        : codec
          ? JSON.stringify(codec.request(path, body))
          : teamHttpCodec(9).encodeRequest(method, path, body, {});
    const response = await fetch(base + path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: encoded,
    });
    requests.push({ method, path, body, status: response.status });
    const value = await response.json();
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return decode(
      codec
        ? codec.response(path, response.status, value)
        : teamHttpCodec(9).decodeResponse(method, path, response.status, value),
    );
  };
  const capabilities = new Map([["fixture", [EVENTS_CAPABILITY, ROUTINE_STATUS_CAPABILITY]]]);
  const { actions } = createHostRequestActions({
    request,
    teamApi: () => request,
    queryClient: client,
    queryScope: ["http://fixture.invalid", "fixture", 1],
    capabilities,
    attachmentDownloads: { current: Promise.resolve() },
  });
  const input = {
    agentId: agent.id,
    name: "Saved mobile schedule",
    instruction: "Keep the alert.",
    active: false,
    timezone: "UTC",
    schedule: { kind: "hourly", minute: 0 } as const,
    silent: true,
  };
  const cacheKey = queryKeys.agentRecord(["http://fixture.invalid", "fixture", 1], "fixture", agent.id, "routines");
  client.setQueryData(cacheKey, []);
  const saved = await actions.createAgentRoutine(input, "fixture");
  const created = routines.list(agent.id).find((routine) => routine.name === input.name);
  assert.ok(created, "The released scheduled create must save a record.");
  checks.push({
    name: "A mobile scheduled create returns its saved id.",
    passed: Boolean(saved && saved.id === created.id),
    actual: saved ?? null,
  });
  checks.push({
    name: "A member mobile scheduled create saves Silent through the optional route.",
    passed: created.silent === true,
    actual: created.silent,
  });
  const createdCache = client.getQueryData(cacheKey);
  checks.push({
    name: "The mobile cache keeps the returned record after its preference saves.",
    passed:
      Array.isArray(createdCache) &&
      createdCache.some((routine) => routine.id === created.id && routine.silent === true),
    actual: createdCache,
  });
  routines.update({ agentId: agent.id, routineId: created.id, silent: true });
  let updated: unknown;
  let updateError: string | undefined;
  try {
    updated = await actions.updateAgentRoutine({ agentId: agent.id, routineId: created.id, silent: false }, "fixture");
  } catch (cause) {
    updateError = cause instanceof Error ? cause.message : String(cause);
  }
  checks.push({
    name: "A mobile preference-only edit returns the record and saves explicit false.",
    passed: Boolean(
      updated &&
        typeof updated === "object" &&
        "id" in updated &&
        updated.id === created.id &&
        "silent" in updated &&
        updated.silent === false &&
        routines.get(agent.id, created.id)?.silent === false,
    ),
    actual: { returned: updated ?? null, stored: routines.get(agent.id, created.id)?.silent, updateError },
  });
  failStatus = true;
  const countBeforePartial = routines.list(agent.id).length;
  const partial = await actions.createAgentRoutine({ ...input, name: "Partial create" }, "fixture");
  failStatus = false;
  const partialCache = client.getQueryData(cacheKey);
  checks.push({
    name: "A failed create preference retains one created id in the return and cache.",
    passed: Boolean(
      partial &&
        partial.silent === false &&
        routines.list(agent.id).length === countBeforePartial + 1 &&
        Array.isArray(partialCache) &&
        partialCache.some((routine) => routine.id === partial.id),
    ),
    actual: { returned: partial ?? null, count: routines.list(agent.id).length, cache: partialCache },
  });
  await actions.updateAgentRoutine({ agentId: agent.id, routineId: partial.id, silent: true }, "fixture");
  checks.push({
    name: "A preference retry changes the existing routine without another create.",
    passed:
      routines.list(agent.id).length === countBeforePartial + 1 && routines.get(agent.id, partial.id)?.silent === true,
    actual: routines.list(agent.id).length,
  });
  let eventError: string | undefined;
  try {
    await actions.saveEventRoutine(
      {
        owner: { kind: "agent", id: agent.id },
        name: "Event route",
        instruction: "Keep alerts.",
        active: false,
        timezone: "UTC",
        trigger: { kind: "schedule", schedule: input.schedule },
        silent: true,
      },
      "fixture",
    );
  } catch (cause) {
    eventError = cause instanceof Error ? cause.message : String(cause);
  }
  checks.push({
    name: "The event save remains admin-only for the same member.",
    passed: eventError === "HTTP 403",
    actual: eventError ?? null,
  });
  enabled = false;
  capabilities.set("fixture", [EVENTS_CAPABILITY]);
  const before = requests.length;
  await actions.createAgentRoutine({ ...input, name: "Old host", silent: undefined }, "fixture");
  checks.push({
    name: "An old host gets only the released schedule create.",
    passed:
      requests.slice(before).length === 1 &&
      requests.slice(before).every((request) => !request.path.includes("routine-status")),
    actual: requests.slice(before),
  });
  enabled = true;
  const channelId = "mobile-channel";
  const channel = channels.store.create(channelId, {
    name: "Mobile channel",
    title: "",
    instructions: "",
    members: [],
    leadAgentId: null,
  });
  database.connection
    .prepare("INSERT INTO projection_channels(channel_id, channel_json) VALUES (?, ?)")
    .run(channelId, JSON.stringify(channel));
  const mobileChannels = new MobileChannelStore((method, path, decode, body) => request(method, path, decode, body));
  mobileChannels.configure("fixture", [CHANNEL_CHATS_CAPABILITY, ROUTINE_STATUS_CAPABILITY]);
  const channelSaved = await mobileChannels.createRoutine("fixture", {
    channelId,
    name: "Channel schedule",
    instruction: input.instruction,
    active: false,
    timezone: "UTC",
    schedule: input.schedule,
    silent: true,
  });
  const createdChannel = channelRoutines.list(channelId)[0];
  assert.ok(createdChannel);
  checks.push({
    name: "A mobile channel create returns its id and saves Silent.",
    passed: Boolean(channelSaved && channelSaved.id === createdChannel.id && createdChannel.silent === true),
    actual: { returned: channelSaved ?? null, stored: createdChannel.silent },
  });
  let channelError: string | undefined;
  let channelUpdated: unknown;
  channelRoutines.update({ channelId, routineId: createdChannel.id, silent: true });
  try {
    channelUpdated = await mobileChannels.updateRoutine("fixture", {
      channelId,
      routineId: createdChannel.id,
      silent: false,
    });
  } catch (cause) {
    channelError = cause instanceof Error ? cause.message : String(cause);
  }
  checks.push({
    name: "A mobile channel preference-only edit saves false and returns its record.",
    passed: Boolean(channelUpdated && channelRoutines.get(channelId, createdChannel.id)?.silent === false),
    actual: {
      returned: channelUpdated ?? null,
      stored: channelRoutines.get(channelId, createdChannel.id)?.silent,
      channelError,
    },
  });
  mobileChannels.dispose();
  checks.push({
    name: "Released schedule requests omit the optional Silent field.",
    passed: requests
      .filter((request) => request.path.includes("/routines") && !request.path.includes("/admin/"))
      .every((request) => !request.body || typeof request.body !== "object" || !("silent" in request.body)),
    actual: requests.filter((request) => request.path.includes("/routines")).map((request) => request.body),
  });
  for (const check of checks) assert.ok(check.passed, `${check.name} Actual ${JSON.stringify(check.actual)}`);
} catch (cause) {
  error = cause instanceof Error ? cause.message : String(cause);
} finally {
  client.clear();
  if (server.listening)
    await new Promise<void>((resolve, reject) => server.close((cause) => (cause ? reject(cause) : resolve())));
  database.close();
  await mkdir(out, { recursive: true });
  const report = {
    passed: !error,
    checks,
    requests,
    error,
    scope:
      "Production mobile request actions, frozen HTTP codecs, Team route permissions, and temporary SQLite. Native crypto, files, and text adapters are inert. The workspace selector and native editor rendering are not verified.",
  };
  await writeFile(join(out, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report)}\n`);
  await rm(root, { recursive: true, force: true });
}
if (error) process.exitCode = 1;
