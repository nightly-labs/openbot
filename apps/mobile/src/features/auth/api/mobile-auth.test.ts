import { createMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  listMobileAccountSessions,
  logoutMobileSession,
  type MobileSession,
  MobileSessionExpiredError,
  readMobileSession,
  redeemMobileConnectUrl,
  revokeMobileAccountSession,
  updateMobileProfile,
  validateMobileSession,
} from "./mobile-auth";

// The native Keychain and HTTP transport are the boundary; exercise the real session storage logic.
const native = vi.hoisted(() => ({ storage: new Map<string, string>(), fetch: vi.fn<typeof fetch>() }));
vi.mock("expo/fetch", () => ({ fetch: native.fetch }));
vi.mock("expo-crypto", () => ({}));
vi.mock("expo-device", () => ({ deviceName: null, modelName: null }));
vi.mock("@/shared/lib/platform", () => ({ isIOS: true, isAndroid: false }));
vi.mock("expo-secure-store", () => ({
  getItemAsync: async (key: string) => native.storage.get(key) ?? null,
  setItemAsync: async (key: string, value: string) => {
    native.storage.set(key, value);
  },
  deleteItemAsync: async (key: string) => {
    native.storage.delete(key);
  },
  WHEN_UNLOCKED_THIS_DEVICE_ONLY: "when-unlocked-this-device-only",
}));

const key = "openbot.mobile.session.v1";
const session: MobileSession = {
  apiUrl: "https://api.openbot.run",
  sessionToken: "test-session-token",
  user: { id: "user", email: "user@example.com", name: null, avatarUrl: null },
  host: { hostId: "desktop-host", fingerprint: "a".repeat(43) },
};
const qrCode = createMobileConnectUrl({ apiUrl: session.apiUrl, ticket: "t".repeat(32), host: session.host });

beforeEach(() => {
  native.storage.clear();
  native.storage.set(key, JSON.stringify(session));
  native.fetch.mockReset();
});
afterEach(() => vi.useRealTimers());

describe("mobile session revocation", () => {
  it.each(["network", "timeout", 500, 401] as const)(
    "retains the credential after %s so logout can be retried",
    async (failure) => {
      vi.useFakeTimers();
      failNextLogout(failure);
      native.fetch.mockResolvedValueOnce(Response.json(session.user));
      const result = logoutMobileSession(session).then(
        () => "signed-out",
        () => "failed",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toBe("failed");
      expect(await readMobileSession()).toEqual(session);

      native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      await logoutMobileSession(session);
      expect(await readMobileSession()).toBeNull();
    },
  );

  it.each(["network", "timeout", 500, 401] as const)(
    "finishes logout immediately when %s hides a completed server revocation",
    async (failure) => {
      vi.useFakeTimers();
      failNextLogout(failure);
      native.fetch.mockResolvedValueOnce(Response.json({ error: { code: "unauthorized" } }, { status: 401 }));
      const result = logoutMobileSession(session).then(
        () => "signed-out",
        () => "failed",
      );
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await result).toBe("signed-out");
      expect(await readMobileSession()).toBeNull();
      expect(native.fetch).toHaveBeenLastCalledWith(
        "https://api.openbot.run/v1/mobile-auth/session",
        expect.objectContaining({
          headers: { Authorization: "Bearer test-session-token" },
        }),
      );
    },
  );

  it.each(["network", 500, "malformed"] as const)(
    "keeps the credential when the follow-up session check fails (%s)",
    async (failure) => {
      failNextLogout(500);
      native.fetch.mockImplementationOnce(async () => {
        if (failure === "network") throw new TypeError("Network unavailable");
        return failure === "malformed" ? Response.json({}) : new Response(null, { status: failure });
      });
      await expect(logoutMobileSession(session)).rejects.toThrow("Could not confirm sign-out.");
      expect(await readMobileSession()).toEqual(session);
    },
  );

  it("does not clear a newer login when the follow-up check confirms the old token was revoked", async () => {
    failNextLogout(401);
    let confirm!: (response: Response) => void;
    native.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = logoutMobileSession(session).then(
      () => "signed-out",
      () => "failed",
    );
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalledTimes(2));
    const replacement = { ...session, sessionToken: "new-test-session-token" };
    native.storage.set(key, JSON.stringify(replacement));
    confirm(Response.json({ error: { code: "unauthorized" } }, { status: 401 }));
    expect(await pending).toBe("signed-out");
    expect(await readMobileSession()).toEqual(replacement);
  });

  it.each([false, true])("waits for confirmed revocation and preserves a newer login (%s)", async (newLogin) => {
    let confirm!: (response: Response) => void;
    native.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = logoutMobileSession(session);
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalledOnce());
    expect(await readMobileSession()).toEqual(session);
    const replacement = { ...session, sessionToken: "new-test-session-token" };
    if (newLogin) native.storage.set(key, JSON.stringify(replacement));
    confirm(new Response(null, { status: 204 }));
    await pending;
    expect(await readMobileSession()).toEqual(newLogin ? replacement : null);
    expect(native.fetch).toHaveBeenCalledWith(
      "https://api.openbot.run/v1/mobile-auth/session",
      expect.objectContaining({
        method: "DELETE",
        headers: { Authorization: "Bearer test-session-token" },
      }),
    );
  });
});

describe("stored mobile desktop binding", () => {
  it("restores a bound session without changing its identity or contacting the service", async () => {
    expect(await readMobileSession()).toEqual(session);
    expect(native.fetch).not.toHaveBeenCalled();
    expect(JSON.parse(native.storage.get(key) ?? "null")).toEqual(session);
  });

  it.each([undefined, null, {}, { hostId: "desktop-host" }, { ...session.host, fingerprint: "invalid" }])(
    "rejects an absent or invalid binding (%j) and revokes the credential before clearing it",
    async (host) => {
      native.storage.set(key, JSON.stringify({ ...session, host }));
      native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await readMobileSession()).toBeNull();
      expect(native.storage.has(key)).toBe(false);
      expect(native.fetch).toHaveBeenCalledWith(
        `${session.apiUrl}/v1/mobile-auth/session`,
        expect.objectContaining({ method: "DELETE", headers: { Authorization: `Bearer ${session.sessionToken}` } }),
      );
    },
  );

  it.each(["network", "timeout", 500] as const)(
    "quarantines a legacy credential after %s and retries revocation on the next read",
    async (failure) => {
      vi.useFakeTimers();
      const legacy = JSON.stringify({ ...session, host: undefined });
      native.storage.set(key, legacy);
      failNextLogout(failure);
      native.fetch.mockResolvedValueOnce(Response.json(session.user));
      const pending = readMobileSession();
      await vi.advanceTimersByTimeAsync(10_000);
      expect(await pending).toBeNull();
      expect(native.storage.get(key)).toBe(legacy);
      native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await readMobileSession()).toBeNull();
      expect(native.storage.has(key)).toBe(false);
    },
  );

  it("clears a legacy token when a failed DELETE is followed by confirmed revocation", async () => {
    native.storage.set(key, JSON.stringify({ ...session, host: undefined }));
    failNextLogout(500);
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    expect(await readMobileSession()).toBeNull();
    expect(native.storage.has(key)).toBe(false);
  });

  it("does not consume a new QR ticket or overwrite a legacy token if revocation is unconfirmed", async () => {
    const legacy = JSON.stringify({ ...session, host: undefined });
    native.storage.set(key, legacy);
    native.fetch.mockImplementation(async (_input, init) => {
      if (init?.method === "POST") throw new Error("A ticket must not be consumed during pending revocation.");
      return new Response(null, { status: 503 });
    });
    await expect(redeemMobileConnectUrl(qrCode)).rejects.toThrow("Could not revoke the previous mobile session.");
    expect(native.storage.get(key)).toBe(legacy);
    expect(native.fetch.mock.calls.map(([, init]) => init?.method ?? "GET")).toEqual(["DELETE", "GET"]);
  });

  it("revokes at the old API before redeeming a QR for another service and restoring its bound session", async () => {
    const oldApi = "https://previous.openbot.run";
    native.storage.set(key, JSON.stringify({ ...session, apiUrl: oldApi, host: undefined }));
    native.storage.set("openbot.mobile.device-id.v1", "existing-device");
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    native.fetch.mockResolvedValueOnce(Response.json(session));
    expect(await redeemMobileConnectUrl(qrCode)).toEqual(session);
    expect(native.fetch.mock.calls.map(([url, init]) => [url, init?.method])).toEqual([
      [`${oldApi}/v1/mobile-auth/session`, "DELETE"],
      [`${session.apiUrl}/v1/mobile-auth/redeem`, "POST"],
    ]);
    expect(await readMobileSession()).toEqual(session);
  });

  it("serializes legacy cleanup with a new QR login so cleanup cannot erase the new session", async () => {
    native.storage.set(key, JSON.stringify({ ...session, host: undefined }));
    native.storage.set("openbot.mobile.device-id.v1", "existing-device");
    let confirm!: (response: Response) => void;
    native.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    native.fetch.mockResolvedValueOnce(Response.json(session));
    const reading = readMobileSession();
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalledOnce());
    const redeeming = redeemMobileConnectUrl(qrCode);
    confirm(new Response(null, { status: 204 }));
    expect(await reading).toBeNull();
    expect(await redeeming).toEqual(session);
    expect(await readMobileSession()).toEqual(session);
  });

  it("does not let an old logout delete a newer quarantined credential", async () => {
    let confirm!: (response: Response) => void;
    native.fetch.mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          confirm = resolve;
        }),
    );
    const pending = logoutMobileSession(session);
    await vi.waitFor(() => expect(native.fetch).toHaveBeenCalledOnce());
    const legacy = JSON.stringify({ ...session, host: undefined, sessionToken: "newer-legacy-token" });
    native.storage.set(key, legacy);
    confirm(new Response(null, { status: 204 }));
    await pending;
    expect(native.storage.get(key)).toBe(legacy);
  });
});

function failNextLogout(failure: "network" | "timeout" | 500 | 401): void {
  native.fetch.mockImplementationOnce(async (_input, init) => {
    if (failure === "network") throw new TypeError("Network request failed");
    if (failure === "timeout") {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
      });
    }
    return Response.json({ error: { message: "Server failure" } }, { status: failure });
  });
}

describe("mobile profile updates", () => {
  it("persists the updated identity for the next launch", async () => {
    const user = { ...session.user, name: "New name" };
    native.fetch.mockResolvedValueOnce(Response.json(user));
    const updated = await updateMobileProfile(session, { name: " New name " });
    expect(updated.user).toEqual(user);
    expect((await readMobileSession())?.user).toEqual(user);
    expect(native.fetch).toHaveBeenCalledWith(
      "https://api.openbot.run/v1/me/profile",
      expect.objectContaining({ method: "PATCH", body: JSON.stringify({ name: "New name" }) }),
    );
  });

  it("does not overwrite a newer login with an old profile response", async () => {
    const newer = { ...session, sessionToken: "new-token" };
    native.fetch.mockImplementationOnce(async () => {
      native.storage.set(key, JSON.stringify(newer));
      return Response.json({ ...session.user, name: "Old request" });
    });
    await updateMobileProfile(session, { name: "Old request" });
    expect(await readMobileSession()).toEqual(newer);
  });

  it("retains the profile when saving fails or returns another account", async () => {
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 500 }));
    await expect(updateMobileProfile(session, { name: "New name" })).rejects.toThrow("Could not save");
    native.fetch.mockResolvedValueOnce(Response.json({ ...session.user, id: "other-account" }));
    await expect(updateMobileProfile(session, { name: "New name" })).rejects.toThrow("invalid user");
    expect(await readMobileSession()).toEqual(session);
  });

  it("uploads and removes the profile photo through the existing account API", async () => {
    const user = { ...session.user, avatarUrl: "/v1/avatars/user?v=photo" };
    const avatar = { bytes: new Uint8Array([0xff, 0xd8, 0xff, 0x00]), mimeType: "image/jpeg" as const };
    native.fetch.mockResolvedValueOnce(Response.json(user));
    await updateMobileProfile(session, { avatar });
    expect((await readMobileSession())?.user.avatarUrl).toBe(user.avatarUrl);
    expect(native.fetch).toHaveBeenLastCalledWith(
      "https://api.openbot.run/v1/me/avatar",
      expect.objectContaining({
        method: "PUT",
        body: avatar.bytes.buffer,
        headers: { Authorization: "Bearer test-session-token", "Content-Type": "image/jpeg" },
      }),
    );
    native.fetch.mockResolvedValueOnce(Response.json(session.user));
    await updateMobileProfile(session, { avatar: null });
    expect((await readMobileSession())?.user.avatarUrl).toBeNull();
    expect(native.fetch).toHaveBeenLastCalledWith(
      "https://api.openbot.run/v1/me/avatar",
      expect.objectContaining({ method: "DELETE" }),
    );
  });
});

it("lists account sessions and only disconnects other devices", async () => {
  const current = {
    sessionId: "11111111-1111-4111-8111-111111111111",
    name: "Phone",
    kind: "mobile",
    current: true,
    connectedAt: 1,
    lastActiveAt: 2,
  };
  native.fetch.mockResolvedValueOnce(Response.json({ sessions: [current] }));
  const [item] = await listMobileAccountSessions(session);
  expect(item).toEqual(current);
  await expect(revokeMobileAccountSession(session, item)).rejects.toThrow("Use Sign out");
  native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
  await revokeMobileAccountSession(session, { ...item, current: false });
  expect(native.fetch).toHaveBeenLastCalledWith(
    `https://api.openbot.run/v1/mobile-auth/devices/${current.sessionId}?includeDesktop=true`,
    expect.objectContaining({ method: "DELETE", headers: { Authorization: "Bearer test-session-token" } }),
  );
});

describe("settings request lifecycle", () => {
  it("refreshes the committed profile when validation overlaps an edit", async () => {
    const started = Promise.withResolvers<void>();
    const saveResponse = Promise.withResolvers<Response>();
    let serverUser = session.user;
    native.fetch.mockImplementationOnce(() => {
      started.resolve();
      return saveResponse.promise;
    });
    native.fetch.mockImplementationOnce(async () => Response.json(serverUser));
    const save = updateMobileProfile(session, { name: "Saved name" });
    await started.promise;
    const refresh = validateMobileSession(session);
    serverUser = { ...session.user, name: "Saved name" };
    saveResponse.resolve(Response.json(serverUser));
    await save;
    expect((await refresh)?.user.name).toBe("Saved name");
    expect((await readMobileSession())?.user.name).toBe("Saved name");
  });

  it("rejects a refresh for another account without replacing the stored identity", async () => {
    native.fetch.mockResolvedValueOnce(Response.json({ ...session.user, id: "another-user" }));
    await expect(validateMobileSession(session)).rejects.toThrow("invalid user");
    expect(await readMobileSession()).toEqual(session);
  });

  it.each(["profile", "sessions", "revoke"] as const)(
    "clears only the rejected credential after %s returns 401",
    async (operation) => {
      const target = {
        sessionId: "11111111-1111-4111-8111-111111111111",
        name: "Desktop",
        kind: "desktop" as const,
        current: false,
        connectedAt: 1,
        lastActiveAt: 2,
      };
      const request = () =>
        operation === "profile"
          ? updateMobileProfile(session, { name: "New name" })
          : operation === "sessions"
            ? listMobileAccountSessions(session)
            : revokeMobileAccountSession(session, target);
      native.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await expect(request()).rejects.toBeInstanceOf(MobileSessionExpiredError);
      expect(await readMobileSession()).toBeNull();
      const newer = { ...session, sessionToken: "new-login" };
      native.storage.set(key, JSON.stringify(newer));
      native.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
      await expect(request()).rejects.toBeInstanceOf(MobileSessionExpiredError);
      expect(await readMobileSession()).toEqual(newer);
    },
  );

  it("cancels an account session read when its screen no longer needs the result", async () => {
    const started = Promise.withResolvers<void>();
    let requestSignal: AbortSignal | null | undefined;
    native.fetch.mockImplementationOnce(
      (_url, init) =>
        new Promise((_resolve, reject) => {
          requestSignal = init?.signal;
          init?.signal?.addEventListener("abort", () => reject(new Error("Request aborted")), { once: true });
          started.resolve();
        }),
    );
    const controller = new AbortController();
    const request = listMobileAccountSessions(session, controller.signal);
    const rejected = expect(request).rejects.toThrow("Request aborted");
    await started.promise;
    controller.abort();
    expect(requestSignal?.aborted).toBe(true);
    await rejected;
    expect(await readMobileSession()).toEqual(session);
  });

  it("rejects invalid and oversized photos before uploading", async () => {
    await expect(
      updateMobileProfile(session, { avatar: { bytes: new Uint8Array([1, 2, 3]), mimeType: "image/jpeg" } }),
    ).rejects.toThrow("selected photo is invalid");
    await expect(
      updateMobileProfile(session, { avatar: { bytes: new Uint8Array(512 * 1024 + 1), mimeType: "image/png" } }),
    ).rejects.toThrow("smaller than 512 KB");
    expect(native.fetch).not.toHaveBeenCalled();
    expect(await readMobileSession()).toEqual(session);
  });

  it("allows retry after rate limiting without losing the existing profile", async () => {
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 429 }));
    await expect(updateMobileProfile(session, { name: "New name" })).rejects.toThrow("Too many changes");
    expect(await readMobileSession()).toEqual(session);
    native.fetch.mockResolvedValueOnce(Response.json({ ...session.user, name: "New name" }));
    await updateMobileProfile(session, { name: "New name" });
    expect((await readMobileSession())?.user.name).toBe("New name");
  });
});
