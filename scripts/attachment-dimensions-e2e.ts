import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { isDynamicRecord } from "@openbot/contracts/runtime-values";
import { TEAM_API_ROUTES } from "@openbot/contracts/team-api-routes";
import {
  TEAM_APP_VERSION_HEADER,
  TEAM_PROTOCOL_V1_WEBSOCKET,
  TEAM_PROTOCOL_VERSION_HEADER,
} from "@openbot/contracts/team-protocol";
import {
  addAttachmentDimensions,
  TEAM_ATTACHMENT_DIMENSIONS_CAPABILITY,
} from "@openbot/contracts/team-protocol/attachment-dimensions-v1";
import { teamCapabilitiesForProtocol, teamCapabilityHeaders } from "@openbot/contracts/team-protocol/current";
import { TEAM_PROTOCOL_V10 } from "@openbot/contracts/team-protocol/v10";
import { decodeTeamProtocolV10WebRtcHttpResponse } from "@openbot/contracts/team-protocol/v10-webrtc-adapter";
import { plugin } from "bun";
import { Effect } from "effect";
import type { AgentBrowserHost } from "../src/backend/agent/turn-lifecycle";
import { AgentService } from "../src/backend/agent-service";
import { AgentStore } from "../src/backend/agent-store";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { MailboxStore } from "../src/backend/mailbox-store";
import { OpenBotDatabase } from "../src/backend/openbot-database";
import { SidebarLayoutStore } from "../src/backend/sidebar-layout-store";
import type { TeamApiBrowser } from "../src/main/team-api/dependencies";

const OUT = resolve(import.meta.dirname, "../.openbot-build/attachment-dimensions-e2e");
const HOST_VERSION = "0.0.0-e2e";
const OWNER = { username: "owner-user", password: "owner-password-123" };
const STEP_DEADLINE_MS = 60_000;

plugin({
  name: "attachment-dimensions-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => HOST_VERSION, isPackaged: false, on: () => undefined },
        BrowserWindow: Object.assign(class extends Inert {}, { getAllWindows: () => [] }),
        MessageChannelMain: class extends Inert {},
        Notification: Object.assign(class extends Inert {}, { isSupported: () => false }),
        clipboard: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: {},
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { TeamApiServer } = await import("../src/main/team-api-server");
const { TeamStore } = await import("../src/main/team-store");
const { requestJson } = await import("../src/main/remote-server-http");

interface Step {
  name: string;
  passed: boolean;
  detail?: unknown;
  error?: string;
}

const report: { passed: boolean; unverified: string[]; steps: Step[] } = {
  passed: false,
  unverified: [
    "The WebRTC transports. Their host peer copies the fields from the HTTP answer that this check reads.",
    "The event streams of the phone, the web client and the desktop. They copy the fields with the same helper.",
    "The phone and browser screens. This check reads the wire data that they get.",
  ],
  steps: [],
};

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  let deadline: ReturnType<typeof setTimeout> | undefined;
  try {
    const value = await Promise.race([
      run(),
      new Promise<never>((_, reject) => {
        deadline = setTimeout(() => reject(new Error(`No result within ${STEP_DEADLINE_MS} ms.`)), STEP_DEADLINE_MS);
      }),
    ]);
    report.steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    report.steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  } finally {
    clearTimeout(deadline);
  }
}

const unused = () => Effect.die(new Error("Not used by this check."));
const agentBrowser: AgentBrowserHost = {
  listTabs: () => [],
  toolCanUseTab: () => false,
  beginTakeover: unused,
  endTakeover: () => {},
  userControlTabFor: () => null,
  awaitUserControlRelease: unused,
  resolveUploadTarget: unused,
  handleDynamicTool: unused,
  onChanged: () => () => {},
  onControlChanged: () => () => {},
  onDocumentChanged: () => () => {},
  clearControls: () => {},
  endControl: () => {},
  close: () => Effect.void,
  clearAgentSession: () => Effect.void,
  shareTab: () => undefined,
  unshareThread: () => undefined,
  agentTab: () => null,
};
const teamBrowser: TeamApiBrowser = {
  listTabs: () => [],
  getControlState: () => ({ sessions: [] }),
  open: unused,
  activate: unused,
  navigate: unused,
  reload: unused,
  stop: unused,
  answerPermission: unused,
  takeUserControl: unused,
  startTeach: unused,
  stopTeach: () => [],
  releaseUserControl: () => {},
  releaseUserControlHeldBy: () => {},
  releaseUserControlRefused: () => {},
  close: unused,
  capturePreview: unused,
  setVisible: unused,
  getDisplayState: () => ({ tabs: [], activeTabId: null }),
  loadUrl: unused,
  isPrivate: () => false,
  startView: unused,
  dispatchViewInput: unused,
  copyViewSelection: unused,
  answerViewDialog: unused,
  importSignIn: unused,
  answerHttpSignIn: unused,
};

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index;
  for (let bit = 0; bit < 8; bit += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
  return value >>> 0;
});

function crc32(bytes: Uint8Array): number {
  let value = 0xffffffff;
  for (const byte of bytes) value = (CRC_TABLE[(value ^ byte) & 0xff] ?? 0) ^ (value >>> 8);
  return (value ^ 0xffffffff) >>> 0;
}

function pngChunk(type: string, data: Uint8Array): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([length, body, crc]);
}

function pngHeader(width: number, height: number): Buffer {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0);
  header.writeUInt32BE(height, 4);
  header.set([8, 2, 0, 0, 0], 8);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", header),
    pngChunk("IEND", new Uint8Array()),
  ]);
}

function rotatedJpegHeader(width: number, height: number): Buffer {
  const tiff = Buffer.from([
    0x4d, 0x4d, 0x00, 0x2a, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0, 0, 0,
  ]);
  const exif = Buffer.concat([Buffer.from("Exif\0\0", "ascii"), tiff]);
  const app1 = Buffer.alloc(4);
  app1.set([0xff, 0xe1]);
  app1.writeUInt16BE(exif.length + 2, 2);
  const frame = Buffer.alloc(19);
  frame.set([0xff, 0xc0, 0x00, 0x11, 0x08]);
  frame.writeUInt16BE(height, 5);
  frame.writeUInt16BE(width, 7);
  frame.set([3, 1, 0x22, 0, 2, 0x11, 1, 3, 0x11, 1], 9);
  return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, exif, frame, Buffer.from([0xff, 0xd9])]);
}

const root = await mkdtemp(join(tmpdir(), "openbot-attachment-dimensions-"));
const userData = join(root, "user-data");
const home = join(root, "home");

interface Host {
  database: OpenBotDatabase;
  agents: AgentService;
  mailbox: MailboxStore;
  server: InstanceType<typeof TeamApiServer>;
  port: number;
}

let host: Host | null = null;

async function startHost(): Promise<Host> {
  const database = new OpenBotDatabase(userData);
  const agentStore = new AgentStore(userData, home, database);
  const mailbox = new MailboxStore(userData, agentStore.sharedRoot, agentStore.database);
  const sidebar = new SidebarLayoutStore(join(userData, "sidebar-layout.json"));
  const team = new TeamStore(join(userData, "openbot-team-server-v2.json"));
  await runCauseEffect(sidebar.initialize());
  await runCauseEffect(agentStore.initialize());
  await runCauseEffect(mailbox.initialize());
  await runCauseEffect(team.initialize());
  if (!team.getIdentity()) await runCauseEffect(team.configure("E2E Host", OWNER.username, OWNER.password));
  const agents = new AgentService({ store: agentStore, mailbox, browser: agentBrowser, sidebarLayout: sidebar });
  const server = new TeamApiServer({
    store: team,
    agents,
    mailbox,
    browser: teamBrowser,
    sidebarLayout: sidebar,
    appVersion: HOST_VERSION,
  });
  const port = await Effect.runPromise(server.start());
  return { database, agents, mailbox, server, port };
}

async function stopHost(): Promise<void> {
  if (!host) return;
  const stopping = host;
  host = null;
  await Effect.runPromise(stopping.server.stop()).catch(() => undefined);
  await runCauseEffect(stopping.agents.stop()).catch(() => undefined);
  stopping.database.close();
}

function current(): Host {
  assert.ok(host, "The host is not running.");
  return host;
}

const CURRENT = teamCapabilitiesForProtocol(TEAM_PROTOCOL_V10);
const RELEASED = CURRENT.filter((capability) => capability !== TEAM_ATTACHMENT_DIMENSIONS_CAPABILITY);

async function call(
  method: string,
  path: string,
  input: { token?: string; body?: unknown; capabilities?: readonly string[] } = {},
): Promise<{ status: number; body: unknown }> {
  const headers: Record<string, string> = {
    Accept: "application/json",
    [TEAM_PROTOCOL_VERSION_HEADER]: String(TEAM_PROTOCOL_V10),
    [TEAM_APP_VERSION_HEADER]: HOST_VERSION,
    ...teamCapabilityHeaders(TEAM_PROTOCOL_V10, input.capabilities ?? CURRENT),
  };
  if (input.body !== undefined) headers["Content-Type"] = "application/json";
  if (input.token) headers.Authorization = `Bearer ${input.token}`;
  const response = await fetch(`http://127.0.0.1:${current().port}${path}`, {
    method,
    headers,
    body: input.body === undefined ? null : JSON.stringify(input.body),
  });
  const body = await response.text();
  return { status: response.status, body: body ? JSON.parse(body) : null };
}

async function login(): Promise<string> {
  const response = await call("POST", TEAM_API_ROUTES.auth.login, { body: OWNER });
  assert.equal(response.status, 200, `Sign-in returned ${response.status}.`);
  const body = response.body;
  assert.ok(typeof body === "object" && body !== null && "sessionToken" in body);
  return String(body.sessionToken);
}

interface WireAttachment {
  id: string;
  name: string;
  kind: string;
  width?: number;
  height?: number;
}

type Route = { label: string; path: string; list: "deliveries" | "messages" };

function routeAttachments(route: Route, snapshot: unknown): WireAttachment[] {
  const items = isDynamicRecord(snapshot) ? snapshot[route.list] : undefined;
  assert.ok(Array.isArray(items), `No ${route.list} in ${route.label}: ${JSON.stringify(snapshot)}`);
  return items.flatMap((item) => {
    assert.ok(
      isDynamicRecord(item) && Array.isArray(item.attachments),
      `An item in ${route.label} has no attachments.`,
    );
    return item.attachments.map((attachment) => {
      assert.ok(
        isDynamicRecord(attachment) && typeof attachment.id === "string" && typeof attachment.name === "string",
      );
      return {
        id: attachment.id,
        name: attachment.name,
        kind: String(attachment.kind),
        ...(attachment.width === undefined ? {} : { width: Number(attachment.width) }),
        ...(attachment.height === undefined ? {} : { height: Number(attachment.height) }),
      };
    });
  });
}

function byName(attachments: WireAttachment[], name: string): WireAttachment {
  const attachment = attachments.find((candidate) => candidate.name === name);
  assert.ok(attachment, `${name} is not in the answer.`);
  return attachment;
}

const FILES = [
  { name: "wide.png", mimeType: "image/png", bytes: pngHeader(640, 480), expected: { width: 640, height: 480 } },
  {
    name: "rotated.jpg",
    mimeType: "image/jpeg",
    bytes: rotatedJpegHeader(400, 300),
    expected: { width: 300, height: 400 },
  },
  { name: "notes.txt", mimeType: "text/plain", bytes: Buffer.from("not an image"), expected: null },
] as const;

interface SeenSize {
  name: string;
  kind: string;
  width: number | null;
  height: number | null;
}

function checkSizes(attachments: WireAttachment[], withSizes: boolean): SeenSize[] {
  const seen: SeenSize[] = [];
  for (const file of FILES) {
    const attachment = byName(attachments, file.name);
    seen.push({
      name: file.name,
      kind: attachment.kind,
      width: attachment.width ?? null,
      height: attachment.height ?? null,
    });
    if (withSizes && file.expected) {
      assert.equal(attachment.kind, "image", `${file.name} is not an image attachment.`);
      assert.equal(attachment.width, file.expected.width, `${file.name} has the wrong width.`);
      assert.equal(attachment.height, file.expected.height, `${file.name} has the wrong height.`);
    } else {
      assert.equal(attachment.width, undefined, `${file.name} has a width.`);
      assert.equal(attachment.height, undefined, `${file.name} has a height.`);
    }
  }
  return seen;
}

const LIVE_PICTURE = {
  name: "live.png",
  mimeType: "image/png",
  bytes: pngHeader(320, 900),
  expected: { width: 320, height: 900 },
} as const;

let agentId = "";

async function sendPictures(files: ReadonlyArray<{ name: string; mimeType: string; bytes: Uint8Array }>) {
  const { mailbox } = current();
  const drafts = await runCauseEffect(
    mailbox.prepareImportedAttachments(
      [],
      files.map((file) => ({ name: file.name, mimeType: file.mimeType, bytes: file.bytes })),
    ),
  );
  assert.equal(drafts.length, files.length, "The files were not prepared.");
  await runCauseEffect(
    mailbox.enqueue({
      sender: { kind: "user" },
      recipientAgentIds: [agentId],
      text: "pictures",
      draftIds: drafts.map((draft) => draft.id),
    }),
  );
}

function findAttachment(value: unknown, name: string, depth = 0): WireAttachment | null {
  if (depth > 12) return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findAttachment(item, name, depth + 1);
      if (found) return found;
    }
    return null;
  }
  if (!isDynamicRecord(value)) return null;
  if (value.name === name && typeof value.id === "string" && value.kind === "image")
    return {
      id: value.id,
      name,
      kind: "image",
      ...(typeof value.width === "number" ? { width: value.width } : {}),
      ...(typeof value.height === "number" ? { height: value.height } : {}),
    };
  for (const child of Object.values(value)) {
    const found = findAttachment(child, name, depth + 1);
    if (found) return found;
  }
  return null;
}

try {
  host = await startHost();
  const token = await login();

  await step("setup: an agent with a queued message that has two images and a text file", async () => {
    const { agents } = current();
    const agent = await runCauseEffect(
      agents.createAgentProfile({ name: "Pictures", description: "Pictures", avatarSeed: "pictures", avatarHue: null }),
    );
    agentId = agent.id;
    await sendPictures(FILES);
    return agent.id;
  });

  const routes: Route[] = [
    { label: "chat", path: TEAM_API_ROUTES.agent.conversation(agentId), list: "messages" },
    { label: "queue", path: TEAM_API_ROUTES.agent.queue(agentId), list: "deliveries" },
  ];

  async function read(route: Route, input: { token: string; capabilities?: readonly string[] }) {
    const response = await call("GET", route.path, input);
    assert.equal(response.status, 200, `${route.label} returned ${response.status}: ${JSON.stringify(response.body)}`);
    return response;
  }

  const SIZE_READ_ATTEMPTS = 100;
  const imageNames = new Set<string>(FILES.flatMap((file) => (file.expected ? [file.name] : [])));

  async function readUntilSized(route: Route, token: string) {
    for (let attempt = 1; attempt <= SIZE_READ_ATTEMPTS; attempt += 1) {
      const response = await read(route, { token });
      const sized = routeAttachments(route, response.body).every(
        (attachment) => !imageNames.has(attachment.name) || attachment.width !== undefined,
      );
      if (sized) return { response, attempts: attempt };
    }
    throw new Error(`${route.label} did not get the sizes after ${SIZE_READ_ATTEMPTS} reads.`);
  }

  await step("a current client gets the pixel size of each image and none for the text file", async () => {
    const seen: Array<{ route: string; sizes: SeenSize[] }> = [];
    for (const route of routes)
      seen.push({
        route: route.label,
        sizes: checkSizes(routeAttachments(route, (await read(route, { token })).body), true),
      });
    return seen;
  });

  await step("the first live event for a new picture has its size", async () => {
    const socket = new WebSocket(`ws://127.0.0.1:${current().port}${TEAM_API_ROUTES.events}`, [
      TEAM_PROTOCOL_V1_WEBSOCKET,
      `openbot-token.${token}`,
    ]);
    try {
      await new Promise<void>((resolveOpen, reject) => {
        socket.addEventListener("open", () => resolveOpen(), { once: true });
        socket.addEventListener("error", () => reject(new Error("The event socket did not open.")), { once: true });
      });
      socket.send(
        JSON.stringify({
          type: "agent-event-scope",
          includeConversations: true,
          capabilities: CURRENT.filter((capability) => capability !== "agent-runtime-snapshots"),
        }),
      );
      const firstEvent = new Promise<{ type: string; picture: WireAttachment }>((resolveEvent, reject) => {
        socket.addEventListener("message", (message) => {
          const value = JSON.parse(String(message.data));
          const picture = findAttachment(value, LIVE_PICTURE.name);
          if (picture && isDynamicRecord(value)) resolveEvent({ type: String(value.type), picture });
        });
        socket.addEventListener("close", () => reject(new Error("The event socket closed.")), { once: true });
      });
      const [draft] = await runCauseEffect(
        current().mailbox.prepareImportedAttachments(
          [],
          [{ name: LIVE_PICTURE.name, mimeType: LIVE_PICTURE.mimeType, bytes: LIVE_PICTURE.bytes }],
        ),
      );
      assert.ok(draft, "The live picture was not prepared.");
      await runCauseEffect(
        current().agents.sendMessage({ agentId, text: "live picture", attachmentDraftIds: [draft.id] }),
      );
      const { type, picture } = await firstEvent;
      assert.equal(picture.width, LIVE_PICTURE.expected.width, `The ${type} event has the wrong width.`);
      assert.equal(picture.height, LIVE_PICTURE.expected.height, `The ${type} event has the wrong height.`);
      return { event: type, width: picture.width, height: picture.height };
    } finally {
      socket.close();
    }
  });

  await step("the desktop decoder for a joined server over HTTPS keeps the sizes", async () => {
    const seen: Array<{ route: string; sizes: SeenSize[] }> = [];
    for (const route of routes) {
      const decoded = await Effect.runPromise(
        requestJson(`http://127.0.0.1:${current().port}`, route.path, (value) => value, {
          token,
          protocol: TEAM_PROTOCOL_V10,
          appVersion: HOST_VERSION,
          capabilities: CURRENT,
        }),
      );
      seen.push({ route: route.label, sizes: checkSizes(routeAttachments(route, decoded), true) });
    }
    return seen;
  });

  await step("the client decoder keeps the sizes after the frozen protocol codec", async () => {
    const seen: Array<{ route: string; strippedByFrozenCodec: boolean; sizes: SeenSize[] }> = [];
    for (const route of routes) {
      const response = await read(route, { token });
      const frozen = decodeTeamProtocolV10WebRtcHttpResponse("GET", route.path, response.status, response.body);
      const strippedByFrozenCodec = routeAttachments(route, frozen).every(
        (attachment) => attachment.width === undefined,
      );
      addAttachmentDimensions(frozen, response.body);
      seen.push({
        route: route.label,
        strippedByFrozenCodec,
        sizes: checkSizes(routeAttachments(route, frozen), true),
      });
    }
    return seen;
  });

  await step("a released client without the capability gets no size fields and still decodes", async () => {
    const seen: Array<{ route: string; wire: SeenSize[]; decoded: number }> = [];
    for (const route of routes) {
      const response = await read(route, { token, capabilities: RELEASED });
      const decoded = decodeTeamProtocolV10WebRtcHttpResponse("GET", route.path, response.status, response.body);
      seen.push({
        route: route.label,
        wire: checkSizes(routeAttachments(route, response.body), false),
        decoded: routeAttachments(route, decoded).length,
      });
    }
    return seen;
  });

  await step("the sizes stay the same after a host restart", async () => {
    await stopHost();
    host = await startHost();
    const again = await login();
    const seen: Array<{ route: string; reads: number; sizes: SeenSize[] }> = [];
    for (const route of routes) {
      const { response, attempts } = await readUntilSized(route, again);
      seen.push({
        route: route.label,
        reads: attempts,
        sizes: checkSizes(routeAttachments(route, response.body), true),
      });
    }
    return seen;
  });

  report.passed = true;
} finally {
  await stopHost();
  await rm(root, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ passed: report.passed, steps: report.steps.length }, null, 2)}\n`);
}
process.exit(report.passed ? 0 : 1);
