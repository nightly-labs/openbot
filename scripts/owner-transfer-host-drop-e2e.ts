import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { OwnerTransfer } from "@openbot/contracts/owner-transfer";
import { plugin } from "bun";
import { Effect } from "effect";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = join(ROOT, ".openbot-build", "owner-transfer-host-drop-e2e");
const SESSION_TOKEN = "s".repeat(48);
const HOST_ID = "00000000-0000-4000-8000-0000000000d1";
const OLD_DROP_RECHECK_MAX_MS = 30_000;
const DROP_WINDOW_MS = OLD_DROP_RECHECK_MAX_MS + 1_000;
const HOST_LIST = "GET /v2/remote/hosts/";
const OWNER_TRANSFERS = "GET /v2/remote/owner-transfers/";

delete process.env.ELECTRON_RENDERER_URL;

plugin({
  name: "owner-transfer-host-drop-electron-boundary",
  setup(build) {
    class Inert {}
    build.module("electron", () => ({
      loader: "object",
      exports: {
        app: { getPath: () => tmpdir(), getVersion: () => "0.0.0-e2e", isPackaged: false, on: () => undefined },
        BrowserWindow: class extends Inert {
          static getAllWindows() {
            return [];
          }
        },
        MessageChannelMain: class extends Inert {},
        Notification: class extends Inert {
          static isSupported() {
            return false;
          }
        },
        clipboard: {},
        desktopCapturer: {},
        dialog: {},
        ipcMain: { handle: () => undefined, removeHandler: () => undefined, on: () => undefined },
        nativeImage: {},
        net: {},
        powerMonitor: { on: () => undefined },
        safeStorage: { isEncryptionAvailable: () => false },
        screen: { getAllDisplays: () => [] },
        session: {},
        shell: { openExternal: async () => undefined },
        systemPreferences: {},
        webContents: { getAllWebContents: () => [] },
      },
    }));
  },
});

const { runCauseEffect } = await import("../src/backend/effect-boundary");
const { CentralAuthManager } = await import("../src/main/central-auth-manager");
const { forwardOwnerTransferReloads } = await import("../src/main/owner-transfer-reloads");
const { watchServerClaims } = await import("../src/main/remote-server-host-directory");
const { RemoteServerManager } = await import("../src/main/remote-server-manager");
const { RemoteWorkflowError } = await import("../src/main/remote-service-effects");
const { TeamWebRtcBridge } = await import("../src/main/team-webrtc-bridge");
const { TeamWebRtcClientTransport } = await import("../src/main/team-webrtc-client-transport");

const steps: { name: string; passed: boolean; detail?: unknown; error?: string }[] = [];
const requests = new Map<string, number>();
const api: { listsTransfers: boolean; transfers: OwnerTransfer[] } = { listsTransfers: true, transfers: [] };

function requestCount(key: string): number {
  return requests.get(key) ?? 0;
}

function requestSnapshot(): Record<string, number> {
  return Object.fromEntries([...requests].sort(([left], [right]) => left.localeCompare(right)));
}

function transfer(transferId: string): OwnerTransfer {
  return {
    transferId,
    hostId: `host-${transferId}`,
    hostName: "Offered server",
    fromEmail: "owner@example.test",
    fromName: "Owner",
    toEmail: "member@example.test",
    createdAt: Date.now(),
    expiresAt: Date.now() + 86_400_000,
  };
}

const server = createServer((request, response) => {
  const key = `${request.method} ${request.url}`;
  requests.set(key, requestCount(key) + 1);
  const answer = (status: number, body: unknown) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(body));
  };
  if (request.url === "/health/live") return answer(200, { status: "ok" });
  if (request.headers.authorization !== `Bearer ${SESSION_TOKEN}`) return answer(401, { error: "unauthorized" });
  if (key === "GET /v1/me")
    return answer(200, { id: "user-member", email: "member@example.test", name: null, avatarUrl: null });
  if (key === HOST_LIST) {
    const hosts = [
      {
        hostId: HOST_ID,
        name: "Joined server",
        logoKey: null,
        devicePublicKey: "host-public-key",
        keyHandovers: [],
        authEpoch: 1,
        membershipId: "membership-member",
        role: "member",
        memberLimit: 10,
      },
    ];
    return answer(200, api.listsTransfers ? { hosts, pendingIncomingTransfers: api.transfers } : { hosts });
  }
  if (key === OWNER_TRANSFERS) return answer(200, { transfers: api.transfers });
  answer(503, { error: { code: "e2e_unhandled", message: "The fake account service does not serve this path." } });
});

class QuietClientBridge extends TeamWebRtcBridge {
  override readonly start = () => Effect.void;
  override readonly prepareSignal = () => Effect.void;
  override readonly connect = () => Effect.void;
  override readonly disconnect = () => Effect.void;
  override readonly send = () =>
    Effect.fail(new RemoteWorkflowError({ cause: new Error("The quiet bridge has no data channel.") }));
}

function waitFor(read: () => boolean, label: string): Promise<void> {
  return new Promise((done, fail) => {
    const deadline = setTimeout(() => {
      clearInterval(poll);
      fail(new Error(`No ${label} within 10 s.`));
    }, 10_000);
    const poll = setInterval(() => {
      if (!read()) return;
      clearInterval(poll);
      clearTimeout(deadline);
      done();
    }, 20);
  });
}

async function step<T>(name: string, run: () => Promise<T>): Promise<T> {
  process.stdout.write(`- ${name}\n`);
  try {
    const value = await run();
    steps.push({ name, passed: true, detail: value });
    return value;
  } catch (error) {
    steps.push({ name, passed: false, error: error instanceof Error ? error.message : String(error) });
    throw error;
  }
}

function claimWatchDelays(): { delays: number[]; refreshes: number; stoppedOnClaim: boolean } {
  const realSetTimeout = globalThis.setTimeout;
  const pending: (() => void)[] = [];
  const delays: number[] = [];
  const serverIds = ["server-known"];
  let refreshes = 0;
  Reflect.set(globalThis, "setTimeout", (handler: () => void, delay?: number) => {
    delays.push(delay ?? 0);
    pending.push(handler);
    return realSetTimeout(() => undefined, 0);
  });
  try {
    const watch = watchServerClaims({
      serverIds: () => serverIds,
      refresh: () => {
        refreshes += 1;
      },
    });
    watch.add(Date.now() + 60 * 60_000);
    for (let tick = 0; tick < 6; tick += 1) pending.shift()?.();
    serverIds.push("server-claimed");
    pending.shift()?.();
    return { delays, refreshes, stoppedOnClaim: pending.length === 0 };
  } finally {
    Reflect.set(globalThis, "setTimeout", realSetTimeout);
  }
}

await new Promise<void>((done) => server.listen(0, "127.0.0.1", done));
const address = server.address();
assert.ok(address && typeof address === "object");
const root = await mkdtemp(join(tmpdir(), "openbot-owner-transfer-drop-"));
const storagePath = join(root, "session.bin");
await writeFile(
  storagePath,
  Buffer.from(JSON.stringify({ version: 2, sessionToken: SESSION_TOKEN })).toString("base64"),
);
const centralAuth = new CentralAuthManager({
  apiUrl: `http://127.0.0.1:${address.port}`,
  storagePath,
  encrypt: (value) => Buffer.from(value),
  decrypt: (value) => value.toString(),
});
const transport = new TeamWebRtcClientTransport({
  bridge: new QuietClientBridge(),
  listHosts: () => centralAuth.listRemoteHosts(),
  startSession: (hostId) => centralAuth.startRemoteSession(hostId),
  issueTicket: (sessionId, clientPublicKey) => centralAuth.issueRemoteSessionTicket(sessionId, clientPublicKey),
  endSession: (sessionId) => centralAuth.endRemoteSession(sessionId),
  createInvite: (hostId, input) => centralAuth.createRemoteInvite(hostId, input),
  listInvites: (hostId) => centralAuth.listRemoteInvites(hostId),
  previewInvite: (token) => centralAuth.previewRemoteInvite(token),
  acceptInvite: (token) => centralAuth.acceptRemoteInvite(token),
  revokeInvite: (inviteId) => centralAuth.revokeRemoteInvite(inviteId),
  listMembers: (hostId) => centralAuth.listRemoteMembers(hostId),
  updateMember: (hostId, membershipId, role, reactivate) =>
    centralAuth.updateRemoteMember(hostId, membershipId, role, reactivate),
  removeMember: (hostId, membershipId) => centralAuth.removeRemoteMember(hostId, membershipId),
  removeOwnedHost: (hostId) => centralAuth.removeOwnedRemoteHost(hostId),
  setHostHidden: (hostId, hidden) => centralAuth.setRemoteHostHidden(hostId, hidden),
  getPrincipalId: () => centralAuth.getSignedInUser().id,
  controlPlaneUrl: centralAuth.resolveApiUrl("/"),
  downloadHostLogo: (hostId, version) => centralAuth.downloadRemoteHostLogo(hostId, version),
  transferDirectory: join(root, "remote-transfers"),
});
const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8"),
  decrypt: (value: Buffer) => value.toString("utf8"),
};
const unused = () => {
  throw new Error("The account ticket is not used in this check.");
};
const manager = new RemoteServerManager(
  join(root, "remote-servers.json"),
  cipher,
  { createTeamAuthTicket: unused, getEmail: () => "member@example.test" },
  { appVersion: "0.0.0-e2e", webrtcTransport: transport, getLocalHostId: () => null },
);

let invalidations = 0;
let forwards = 0;
let syncs = 0;
const shown: string[][] = [];
manager.on("directoryInvalidated", () => {
  invalidations += 1;
  void runCauseEffect(manager.syncRemoteHosts())
    .catch(() => undefined)
    .finally(() => {
      syncs += 1;
    });
});
forwardOwnerTransferReloads(manager, centralAuth, () => {
  forwards += 1;
  void runCauseEffect(centralAuth.incomingOwnerTransfers()).then(
    (transfers) => shown.push(transfers.map((entry) => entry.transferId)),
    () => shown.push(["error"]),
  );
});

function resetCounts() {
  requests.clear();
  invalidations = 0;
  forwards = 0;
  syncs = 0;
  shown.length = 0;
}

async function invalidateAndSettle(expectedForwards: number) {
  const before = syncs;
  await runCauseEffect(manager.invalidateDirectory());
  await waitFor(() => syncs > before, "host-list refresh");
  if (expectedForwards > 0) await waitFor(() => shown.length >= expectedForwards, "owner-transfer reload");
}

let passed = false;
let failure: string | undefined;
try {
  await step("the member signs in and gets the joined server", async () => {
    const state = await runCauseEffect(centralAuth.initialize());
    assert.equal(state.status, "signed_in");
    await runCauseEffect(manager.initialize());
    await runCauseEffect(manager.awaitHostDirectory());
    assert.ok(
      manager.list().some((entry) => entry.id === HOST_ID),
      "The joined server is missing.",
    );
    await waitFor(() => shown.length >= 1, "first owner-transfer reload");
    return { requests: requestSnapshot(), listsTransfers: centralAuth.listsOwnerTransfers(), shown: [...shown] };
  });

  await step("a host drop makes no owner-transfer and no host-list request", async () => {
    resetCounts();
    transport.emit("connected", HOST_ID);
    transport.emit("disconnected", HOST_ID);
    await new Promise((done) => setTimeout(done, DROP_WINDOW_MS));
    const detail = {
      windowMs: DROP_WINDOW_MS,
      oldRecheckMaxMs: OLD_DROP_RECHECK_MAX_MS,
      hostListRequests: requestCount(HOST_LIST),
      ownerTransferRequests: requestCount(OWNER_TRANSFERS),
      directoryInvalidations: invalidations,
      ownerTransferReloads: forwards,
      requests: requestSnapshot(),
    };
    assert.equal(detail.hostListRequests, 0, "The drop listed the servers.");
    assert.equal(detail.ownerTransferRequests, 0, "The drop loaded the owner transfers.");
    assert.equal(detail.directoryInvalidations, 0, "The drop invalidated the server directory.");
    assert.equal(detail.ownerTransferReloads, 0, "The drop reloaded the owner transfers.");
    return detail;
  });

  await step("an account change with the same transfers lists the servers once and loads no transfers", async () => {
    resetCounts();
    await invalidateAndSettle(0);
    const detail = {
      hostListRequests: requestCount(HOST_LIST),
      ownerTransferRequests: requestCount(OWNER_TRANSFERS),
      ownerTransferReloads: forwards,
    };
    assert.equal(detail.hostListRequests, 1);
    assert.equal(detail.ownerTransferRequests, 0);
    assert.equal(detail.ownerTransferReloads, 0);
    return detail;
  });

  await step("a new transfer in the host list shows with no separate request", async () => {
    resetCounts();
    api.transfers = [transfer("transfer-new")];
    await invalidateAndSettle(1);
    const detail = {
      hostListRequests: requestCount(HOST_LIST),
      ownerTransferRequests: requestCount(OWNER_TRANSFERS),
      ownerTransferReloads: forwards,
      shown: [...shown],
    };
    assert.equal(detail.hostListRequests, 1);
    assert.equal(detail.ownerTransferRequests, 0);
    assert.deepEqual(detail.shown, [["transfer-new"]]);
    return detail;
  });

  await step("an old Worker with no transfer field falls back to the separate request", async () => {
    resetCounts();
    api.listsTransfers = false;
    api.transfers = [transfer("transfer-new"), transfer("transfer-old-worker")];
    await invalidateAndSettle(1);
    const detail = {
      hostListRequests: requestCount(HOST_LIST),
      ownerTransferRequests: requestCount(OWNER_TRANSFERS),
      ownerTransferReloads: forwards,
      listsTransfers: centralAuth.listsOwnerTransfers(),
      shown: [...shown],
    };
    assert.equal(detail.hostListRequests, 1);
    assert.equal(detail.ownerTransferRequests, 1);
    assert.equal(detail.listsTransfers, false);
    assert.deepEqual(detail.shown, [["transfer-new", "transfer-old-worker"]]);
    return detail;
  });

  await step("an old Worker host drop also makes no request", async () => {
    resetCounts();
    transport.emit("connected", HOST_ID);
    transport.emit("disconnected", HOST_ID);
    await new Promise((done) => setTimeout(done, DROP_WINDOW_MS));
    const detail = {
      hostListRequests: requestCount(HOST_LIST),
      ownerTransferRequests: requestCount(OWNER_TRANSFERS),
      directoryInvalidations: invalidations,
    };
    assert.equal(detail.hostListRequests, 0);
    assert.equal(detail.ownerTransferRequests, 0);
    assert.equal(detail.directoryInvalidations, 0);
    return detail;
  });

  await step("a rejected host key lists the servers once until the host connects again", async () => {
    resetCounts();
    transport.emit("hostKeyRejected", HOST_ID);
    transport.emit("hostKeyRejected", HOST_ID);
    await waitFor(() => syncs >= 1, "host-list refresh after a rejected key");
    await new Promise((done) => setTimeout(done, DROP_WINDOW_MS));
    const firstEpisode = { hostListRequests: requestCount(HOST_LIST), directoryInvalidations: invalidations };
    transport.emit("connected", HOST_ID);
    transport.emit("hostKeyRejected", HOST_ID);
    await waitFor(() => syncs >= 2, "host-list refresh after a new rejected key");
    const detail = {
      firstEpisode,
      hostListRequests: requestCount(HOST_LIST),
      directoryInvalidations: invalidations,
    };
    assert.equal(firstEpisode.hostListRequests, 1, "A repeated rejection listed the servers again.");
    assert.equal(firstEpisode.directoryInvalidations, 1);
    assert.equal(detail.hostListRequests, 2, "A rejection after a new connection did not list the servers.");
    assert.equal(detail.directoryInvalidations, 2);
    return detail;
  });

  await step("the claim watch backs off from 5 s to 60 s and stops when the server appears", async () => {
    const watch = claimWatchDelays();
    assert.deepEqual(watch.delays, [5_000, 10_000, 20_000, 40_000, 60_000, 60_000, 60_000]);
    assert.equal(watch.refreshes, 6);
    assert.ok(watch.stoppedOnClaim, "The claim watch did not stop.");
    return watch;
  });

  passed = steps.every((entry) => entry.passed);
} catch (error) {
  failure = error instanceof Error ? error.message : String(error);
} finally {
  await runCauseEffect(manager.stop()).catch(() => undefined);
  await runCauseEffect(centralAuth.dispose()).catch(() => undefined);
  await new Promise<void>((done) => server.close(() => done()));
  await rm(root, { recursive: true, force: true });
  await mkdir(OUT, { recursive: true });
  await writeFile(join(OUT, "report.json"), `${JSON.stringify({ passed, failure, steps }, null, 2)}\n`);
}
for (const entry of steps) process.stdout.write(`${entry.passed ? "ok" : "FAIL"} ${entry.name}\n`);
if (!passed) {
  process.stderr.write(`${failure}\n`);
  process.exit(1);
}
process.exit(0);
