import type {
  RemoteTeamCommand,
  RemoteTeamCommandResult,
  RemoteTeamPeerActions,
} from "@openbot/team-client/remote-peer";
import { afterEach, describe, expect, it, vi } from "vitest";
import { acquireWebHostLock } from "./web-host-lock";
import { createWebWorkspaceRuntime } from "./web-runtime";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** One lock manager for every tab of the test, as the browser has. */
function createLocks() {
  const held = new Set<string>();
  const queues = new Map<string, Array<() => void>>();
  const acquire: typeof acquireWebHostLock = async (accountId, hostId, options = {}) => {
    const name = `${accountId}:${hostId}`;
    const release = () => {
      const next = queues.get(name)?.shift();
      if (next) next();
      else held.delete(name);
    };
    if (!held.has(name)) {
      held.add(name);
      return release;
    }
    const signal = options.wait;
    if (!signal) throw new Error("The host is open in another tab.");
    return new Promise((resolve, reject) => {
      const grant = () => resolve(release);
      queues.set(name, [...(queues.get(name) ?? []), grant]);
      signal.addEventListener("abort", () => {
        queues.set(
          name,
          (queues.get(name) ?? []).filter((entry) => entry !== grant),
        );
        reject(signal.reason);
      });
    });
  };
  return acquire;
}

function createTab(accountId: string, acquireHostLock: typeof acquireWebHostLock, endSession: () => Promise<void>) {
  const peers: Array<{ dispose: ReturnType<typeof vi.fn> }> = [];
  const hostState = vi.fn();
  const runtime = createWebWorkspaceRuntime(
    accountId,
    { connection: vi.fn(), event: vi.fn(), accountChanged: async () => {}, hostState },
    vi.fn(),
    {
      createPeer: (_actions: { current: RemoteTeamPeerActions }) => {
        const peer = {
          execute: vi.fn(
            async (command: RemoteTeamCommand): Promise<RemoteTeamCommandResult> => ({
              commandId: command.id,
              ok: true,
              status: 200,
              body:
                command.type === "request" && command.path === "/v1/compatibility"
                  ? { appVersion: "0.1.0", protocol: { minimum: 1, maximum: 4 }, capabilities: [] }
                  : {},
            }),
          ),
          dispose: vi.fn(endSession),
          sendHostStreamData: vi.fn(),
          cancelUpload: vi.fn(async () => undefined),
          setActive: vi.fn(),
        };
        peers.push(peer);
        return peer;
      },
      acquireHostLock,
      openHostChannel: (id) => new BroadcastChannel(`openbot.test.hosts:${id}`),
    },
  );
  return { runtime, peers, hostState };
}
describe("browser host ownership", () => {
  it("refuses a second tab for the same account and host, then permits it after release", async () => {
    const held = new Set<string>();
    const request = vi.fn(
      async (
        name: string,
        _options: { ifAvailable: boolean },
        callback: (lock: { name: string; mode: "exclusive" } | null) => Promise<void>,
      ) => {
        if (held.has(name)) return callback(null);
        held.add(name);
        try {
          await callback({ name, mode: "exclusive" });
        } finally {
          held.delete(name);
        }
      },
    );
    vi.stubGlobal("navigator", { locks: { request } });
    const release = await acquireWebHostLock("one", "host");
    await expect(acquireWebHostLock("one", "host")).rejects.toThrow("another tab");
    const otherAccount = await acquireWebHostLock("two", "host");
    const otherHost = await acquireWebHostLock("one", "other-host");
    release();
    await vi.waitFor(() => expect(held.has("openbot.web.host:one:host")).toBe(false));
    const next = await acquireWebHostLock("one", "host");
    next();
    otherAccount();
    otherHost();
    await vi.waitFor(() => expect(held.size).toBe(0));
  });
  it("hands a status connection to the tab that opens its host, and keeps an opened host", async () => {
    // The locks themselves are the fake below; the handoff only checks that the browser has a lock manager.
    vi.stubGlobal("navigator", { locks: {} });
    const acquire = createLocks();
    let endSession: () => void = () => {};
    const sessionEnded = new Promise<void>((resolve) => {
      endSession = resolve;
    });
    const host = {
      hostId: "host",
      name: "Host",
      logoKey: null,
      devicePublicKey: "key-one",
      membershipId: "membership",
      role: "owner" as const,
    };
    const first = createTab("one", acquire, () => sessionEnded);
    first.runtime.hosts?.setHosts([host]);
    await vi.waitFor(() => expect(first.hostState).toHaveBeenCalledWith("host", "online"));

    const second = createTab("one", acquire, async () => undefined);
    let opened = false;
    const opening = second.runtime.connect(host).then((capabilities) => {
      opened = true;
      return capabilities;
    });
    // The status connection ends its session before the lock moves to the tab that asked.
    await vi.waitFor(() => expect(first.peers.at(-1)?.dispose).toHaveBeenCalled());
    expect(opened).toBe(false);
    endSession();
    await expect(opening).resolves.toEqual([]);

    // A tab that has the host open refuses at once; the other tab does not wait for a timeout.
    const third = createTab("one", acquire, async () => undefined);
    await expect(third.runtime.connect(host)).rejects.toThrow("another tab");

    await Promise.all([first.runtime.dispose(), second.runtime.dispose(), third.runtime.dispose()]);
  });
  it("refuses connection when the browser has no lock manager", async () => {
    vi.stubGlobal("navigator", {});
    await expect(acquireWebHostLock("one", "host")).rejects.toThrow("cannot protect");
  });
});
