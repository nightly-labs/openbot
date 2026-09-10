import type { ConversationSnapshot } from "@openbot/contracts/ipc";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createRemoteConnectionRecovery,
  createRemoteReadRefresh,
  mergeRemoteUnreadIds,
  remoteConnectionFailure,
  remoteRecoveryMessage,
  resyncRemoteConversations,
} from "./remote-recovery";

afterEach(() => vi.useRealTimers());

describe("remote connection recovery", () => {
  it("keeps foreground checks and explicit data refreshes online", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => {});
    const status = vi.fn();
    const recovery = createRemoteConnectionRecovery(load, () => {}, status);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    status.mockClear();
    recovery.setActive(false);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    expect(status.mock.calls.map(([value]) => value.phase)).toEqual(["online"]);
    status.mockClear();
    recovery.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    expect(status.mock.calls.map(([value]) => value.phase)).toEqual(["online"]);
    recovery.dispose();
  });

  it("replaces a stale peer immediately after a resume read fails, then preserves failure backoff", async () => {
    vi.useFakeTimers();
    const load = vi.fn().mockResolvedValueOnce(undefined).mockRejectedValue(new Error("Offline"));
    const recovery = createRemoteConnectionRecovery(load, () => {});
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    recovery.setActive(false);
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(3);
    for (let visit = 0; visit < 5; visit += 1) {
      recovery.setActive(false);
      recovery.setActive(true);
    }
    await vi.advanceTimersByTimeAsync(9_999);
    expect(load).toHaveBeenCalledTimes(3);
    await vi.advanceTimersByTimeAsync(1);
    expect(load).toHaveBeenCalledTimes(4);
    recovery.dispose();
  });

  it.each([true, false])(
    "preserves failure backoff when an attempt finishes with foreground=%s",
    async (foreground) => {
      vi.useFakeTimers();
      let fail = (_error: Error) => {};
      const pending = new Promise<void>((_resolve, reject) => {
        fail = reject;
      });
      const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
      const recovery = createRemoteConnectionRecovery(load, () => {});
      recovery.setActive(true);
      recovery.setActive(false);
      if (foreground) recovery.setActive(true);
      fail(new Error("Desktop offline"));
      await vi.advanceTimersByTimeAsync(0);
      recovery.setActive(true);
      await vi.advanceTimersByTimeAsync(9_999);
      expect(load).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(load).toHaveBeenCalledTimes(2);
      recovery.dispose();
    },
  );

  it("retains a data invalidation received in the background until resume", async () => {
    vi.useFakeTimers();
    const load = vi.fn(async () => {});
    const recovery = createRemoteConnectionRecovery(load, () => {});
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    recovery.setActive(false);
    recovery.refresh();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(load).toHaveBeenCalledTimes(1);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it.each([false, true])("replaces interrupted reads once after resume with cancellation=%s", async (cancelled) => {
    vi.useFakeTimers();
    let finish = () => {};
    const pending = new Promise<void>((resolve, reject) => {
      finish = () => (cancelled ? reject(new Error("The app is in the background.")) : resolve());
    });
    const load = vi.fn().mockReturnValueOnce(pending).mockResolvedValue(undefined);
    const recovery = createRemoteConnectionRecovery(load, () => {});
    recovery.setActive(true);
    recovery.setActive(false);
    recovery.setActive(true);
    expect(load).toHaveBeenCalledTimes(1);
    finish();
    await vi.advanceTimersByTimeAsync(0);
    expect(load).toHaveBeenCalledTimes(2);
    recovery.dispose();
  });

  it.each([
    "The host already has an active remote session.",
    "Too many active remote connections.",
    "The server request failed.",
    "The remote session is not active.",
    "The account session has ended.",
  ])("keeps safe failure %s visible through retries and clears it when connected", async (reason) => {
    vi.useFakeTimers();
    let failure: string | null = null;
    let message: string | null = null;
    const recovery = createRemoteConnectionRecovery(
      async () => {},
      (error) => {
        failure = remoteConnectionFailure("connection", error);
      },
      (status) => {
        message = remoteRecoveryMessage(status, failure);
      },
    );
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    recovery.offline(new Error(reason));
    expect(message).toContain(`Connecting to the desktop: ${reason}`);
    await vi.advanceTimersByTimeAsync(0);
    expect(message).toBeNull();
    recovery.dispose();
  });

  it("does not expose credentials or response contents in connection diagnostics", () => {
    const sensitive = "Bearer test-private-token; secret=private-value; conversation=private-message";
    expect(remoteConnectionFailure("compatibility", new Error(sensitive))).toBe(
      "Checking desktop compatibility: Could not complete this connection step.",
    );
    expect(remoteConnectionFailure("preferences", new TypeError(sensitive))).toBe(
      "Loading local chat preferences: Could not complete this connection step.",
    );
    expect(remoteConnectionFailure("agents", new SyntaxError(sensitive))).toBe(
      "Loading agents: Could not complete this connection step.",
    );
    expect(remoteConnectionFailure("reads", sensitive)).toBe(
      "Loading read status: Could not complete this connection step.",
    );
    expect(
      remoteRecoveryMessage(
        { phase: "cooldown", attempt: 5, remainingSeconds: 120 },
        remoteConnectionFailure("connection", new Error("The desktop did not connect.")),
      ),
    ).toContain("Connecting to the desktop: The desktop did not connect.");
  });

  it("does not let an initial read overwrite a newer event refresh", async () => {
    const refresh = createRemoteReadRefresh();
    let unread = ["agent"];
    const apply = (reads: Record<string, { unreadCount: number }>) => {
      unread = mergeRemoteUnreadIds(unread, reads);
    };
    const initial = deferredReads();
    const loading = refresh.refresh(
      "host",
      () => initial.promise,
      apply,
      () => true,
    );
    await refresh.refresh(
      "host",
      async () => ({ agent: { unreadCount: 0 } }),
      apply,
      () => true,
    );
    initial.resolve({ agent: { unreadCount: 1 } });
    await loading;
    expect(unread).toEqual([]);
  });

  it("invalidates pending reads when a cursor changes without discarding another server's read", async () => {
    const refresh = createRemoteReadRefresh();
    let unread = ["agent"];
    const apply = (reads: Record<string, { unreadCount: number }>) => {
      unread = mergeRemoteUnreadIds(unread, reads);
    };
    const initial = deferredReads();
    const other = deferredReads();
    const loading = refresh.refresh(
      "host",
      () => initial.promise,
      apply,
      () => true,
    );
    const loadingOther = refresh.refresh(
      "other",
      () => other.promise,
      apply,
      () => true,
    );
    refresh.invalidate("host");
    apply({ agent: { unreadCount: 0 } });
    initial.resolve({ agent: { unreadCount: 1 } });
    other.resolve({ remote: { unreadCount: 1 } });
    await Promise.all([loading, loadingOther]);
    expect(unread).toEqual(["remote"]);
  });

  it("applies live unread changes without erasing another server's unread agents", () => {
    expect(
      mergeRemoteUnreadIds(["other-server", "read-now"], {
        "read-now": { unreadCount: 0 },
        "new-reply": { unreadCount: 1 },
      }),
    ).toEqual(["other-server", "new-reply"]);
  });
  it("shows five attempts ten seconds apart, then a two-minute cooldown before restarting at one", async () => {
    vi.useFakeTimers();
    let desktopOnline = false;
    let connected = false;
    let attempts = 0;
    const errors: unknown[] = [];
    const messages: Array<string | null> = [];
    const connecting: string[] = [];
    const recovery = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
        if (!desktopOnline) throw new Error("Desktop offline");
        connected = true;
      },
      (error) => errors.push(error),
      (status) => {
        const message = remoteRecoveryMessage(status);
        messages.push(message);
        if (status.phase === "connecting" && message) connecting.push(message);
      },
    );
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);
    expect(messages.at(-1)).toBe("Connection attempt failed. Retrying in 10s.");
    await vi.advanceTimersByTimeAsync(9_999);
    expect(attempts).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(2);
    await vi.advanceTimersByTimeAsync(30_000);
    expect(attempts).toBe(5);
    expect(connecting).toEqual([
      "Reconnecting 1/5",
      "Reconnecting 2/5",
      "Reconnecting 3/5",
      "Reconnecting 4/5",
      "Reconnecting 5/5",
    ]);
    expect(messages.at(-1)).toBe("Connection failed after 5 attempts. Retrying in 2:00.");
    recovery.setActive(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(attempts).toBe(5);
    desktopOnline = true;
    recovery.setActive(true);
    recovery.offline();
    expect(messages.at(-1)).toBe("Connection failed after 5 attempts. Retrying in 1:00.");
    await vi.advanceTimersByTimeAsync(59_999);
    expect(attempts).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    await vi.advanceTimersByTimeAsync(0);
    expect(connected).toBe(true);
    expect(attempts).toBe(6);
    expect(connecting.at(-1)).toBe("Reconnecting 1/5");
    expect(messages.at(-1)).toBeNull();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(attempts).toBe(6);
    connected = false;
    const attemptsBeforeRetry = connecting.length;
    recovery.offline();
    expect(messages.at(-1)).toBe("Reconnecting 1/5");
    await vi.advanceTimersByTimeAsync(0);
    expect(connected).toBe(true);
    expect(connecting.slice(attemptsBeforeRetry)).toEqual(["Reconnecting 1/5"]);
    expect(connecting.at(-1)).toBe("Reconnecting 1/5");
    expect(errors).toHaveLength(5);
    recovery.dispose();
  });

  // Ten seconds apart, five times, then every two minutes, for as long as the app is open -- all of
  // it asking a service that would answer with the same unreadable frame.
  it("stops retrying a failure a retry cannot fix, and tries once when the app comes back", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    const messages: Array<string | null> = [];
    const recovery = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
      },
      () => {},
      (status) => messages.push(remoteRecoveryMessage(status)),
    );
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(1);

    recovery.suspend(new Error("Signal returned an invalid message."));
    await vi.advanceTimersByTimeAsync(300_000);
    expect(attempts).toBe(1);
    expect(messages.at(-1)).toBe("Update OpenBot Mobile or the desktop app before connecting.");

    // The desktop the user left to update is the reason the frame was unreadable, so returning to
    // the app is the way out of this state.
    recovery.setActive(false);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    recovery.dispose();
  });

  it("retries immediately on manual refresh without overlapping a pending attempt", async () => {
    vi.useFakeTimers();
    let rejectInitial = (_error: Error) => {};
    const initial = new Promise<void>((_resolve, reject) => {
      rejectInitial = reject;
    });
    let attempts = 0;
    let phase = "";
    const controller = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
        if (attempts === 1) await initial;
        if (attempts < 3) throw new Error("Offline");
      },
      () => {},
      (status) => {
        phase = status.phase;
      },
    );
    controller.setActive(true);
    controller.refresh();
    rejectInitial(new Error("Offline"));
    await vi.advanceTimersByTimeAsync(0);
    expect({ attempts, phase }).toEqual({ attempts: 2, phase: "waiting" });
    controller.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect({ attempts, phase }).toEqual({ attempts: 3, phase: "online" });
    controller.dispose();
  });

  it("does not report online when a suspended in-flight attempt finishes", async () => {
    vi.useFakeTimers();
    let resolveConnection = () => {};
    const connection = new Promise<void>((resolve) => {
      resolveConnection = resolve;
    });
    let phase = "";
    const controller = createRemoteConnectionRecovery(
      () => connection,
      () => {},
      (status) => {
        phase = status.phase;
      },
    );
    controller.setActive(true);
    controller.suspend();
    resolveConnection();
    await vi.advanceTimersByTimeAsync(0);
    expect(phase).toBe("suspended");
    controller.dispose();
  });

  it("does not overlap connection attempts and ignores a disposed server", async () => {
    vi.useFakeTimers();
    let resolve = () => {};
    const promise = new Promise<void>((done) => {
      resolve = done;
    });
    let attempts = 0;
    const recovery = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
        await promise;
      },
      () => {},
    );
    recovery.setActive(true);
    recovery.offline();
    recovery.offline();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(attempts).toBe(1);
    resolve();
    // The retry deadline already elapsed, but no new work starts until the old work settles.
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(2);
    recovery.dispose();
    recovery.offline();
    await vi.advanceTimersByTimeAsync(180_000);
    expect(attempts).toBe(2);
  });

  it("shows cooldown as soon as the fifth attempt reports offline, without waiting for command cleanup", async () => {
    vi.useFakeTimers();
    let rejectFifth = (_error: Error) => {};
    let attempts = 0;
    let message: string | null = null;
    const recovery = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
        if (attempts < 5) throw new Error("Offline");
        if (attempts === 5) {
          await new Promise<void>((_resolve, reject) => {
            rejectFifth = reject;
          });
        }
      },
      () => {},
      (status) => {
        message = remoteRecoveryMessage(status);
      },
    );
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(attempts).toBe(5);
    expect(message).toBe("Reconnecting 5/5");
    recovery.offline();
    expect(message).toBe("Connection failed after 5 attempts. Retrying in 2:00.");
    recovery.offline();
    await vi.advanceTimersByTimeAsync(1_000);
    expect(message).toBe("Connection failed after 5 attempts. Retrying in 1:59.");
    rejectFifth(new Error("Connection command finished cleaning up"));
    await vi.advanceTimersByTimeAsync(0);
    expect(message).toBe("Connection failed after 5 attempts. Retrying in 1:59.");
    await vi.advanceTimersByTimeAsync(118_999);
    expect(attempts).toBe(5);
    await vi.advanceTimersByTimeAsync(1);
    expect(attempts).toBe(6);
    expect(message).toBeNull();
    recovery.dispose();
  });

  it("does no work in the background and starts only one attempt after an expired cooldown", async () => {
    vi.useFakeTimers();
    let attempts = 0;
    let updates = 0;
    const recovery = createRemoteConnectionRecovery(
      async () => {
        attempts += 1;
        throw new Error("Offline");
      },
      () => {},
      () => {
        updates += 1;
      },
    );
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(40_000);
    expect(attempts).toBe(5);
    recovery.setActive(false);
    const beforeBackground = updates;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(attempts).toBe(5);
    expect(updates).toBe(beforeBackground);
    recovery.setActive(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(attempts).toBe(6);
    recovery.dispose();
    const beforeDispose = updates;
    await vi.advanceTimersByTimeAsync(600_000);
    expect(attempts).toBe(6);
    expect(updates).toBe(beforeDispose);
  });
});

describe("conversation recovery after an event reset", () => {
  it("replaces stale cached conversations only for agents in the recovered server", async () => {
    const snapshot = (agentId: string, text: string, revision: number): ConversationSnapshot => ({
      agentId,
      threadId: null,
      activeTurnId: null,
      revision,
      messages: [{ id: "message", author: "assistant", text, status: "completed", createdAt: "2026-09-03T00:00:00Z" }],
    });
    const cached: Record<string, ConversationSnapshot> = {
      local: snapshot("local", "old", 1),
      other: snapshot("other", "untouched", 1),
    };
    const loaded: string[] = [];
    await resyncRemoteConversations({
      agentIds: ["local", "unopened"],
      cached,
      load: async (id) => {
        loaded.push(id);
        return snapshot(id, "missed response", 2);
      },
      apply: (value) => {
        cached[value.agentId] = value;
      },
      isCurrent: () => true,
    });
    expect(cached.local?.messages[0]?.text).toBe("missed response");
    expect(cached.other?.messages[0]?.text).toBe("untouched");
    expect(loaded).toEqual(["local"]);
  });
  it("does not apply a recovery snapshot after switching servers", async () => {
    let current = true;
    const old: ConversationSnapshot = {
      agentId: "agent",
      threadId: null,
      activeTurnId: null,
      revision: 1,
      messages: [],
    };
    let displayed = old;
    await resyncRemoteConversations({
      agentIds: ["agent"],
      cached: { agent: old },
      load: async () => {
        current = false;
        return { ...old, revision: 2 };
      },
      apply: (value) => {
        displayed = value;
      },
      isCurrent: () => current,
    });
    expect(displayed.revision).toBe(1);
  });
});

function deferredReads() {
  let resolve: (value: Record<string, { unreadCount: number }>) => void = () => {};
  const promise = new Promise<Record<string, { unreadCount: number }>>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
