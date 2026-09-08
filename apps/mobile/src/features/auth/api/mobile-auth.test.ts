import { createMobileConnectUrl } from "@openbot/contracts/mobile-connect";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveSessionValidation } from "../context/session-validation";
import {
  listMobileAccountSessions,
  logoutMobileSession,
  type MobileSession,
  MobileSessionExpiredError,
  readMobileSession,
  redeemMobileConnectUrl,
  retryMobileSessionRevocations,
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
afterEach(async () => {
  await retryMobileSessionRevocations();
  vi.useRealTimers();
});

describe("mobile session revocation", () => {
  it.each(["network", "timeout", 500, 401] as const)(
    "signs out locally after %s and retains only a pending revocation",
    async (failure) => {
      vi.useFakeTimers();
      failNextLogout(failure);
      native.fetch.mockResolvedValueOnce(Response.json(session.user));
      await logoutMobileSession(session);
      expect(native.storage.has(key)).toBe(false);
      expect(JSON.parse(native.storage.get("openbot.mobile.pending-revocations.v1") ?? "null")).toEqual([
        { apiUrl: session.apiUrl, sessionToken: session.sessionToken },
      ]);
      const retry = retryMobileSessionRevocations();
      await vi.advanceTimersByTimeAsync(20_000);
      await retry;
      expect(native.storage.has("openbot.mobile.pending-revocations.v1")).toBe(true);
      native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
      expect(await readMobileSession()).toBeNull();
      await retryMobileSessionRevocations();
      expect(native.storage.has("openbot.mobile.pending-revocations.v1")).toBe(false);
    },
  );

  it("processes a sign-out queued during a retry without repeating failed credentials", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    const replacement = { ...session, apiUrl: "https://other.example.com", sessionToken: "replacement-token" };
    native.fetch.mockImplementation(async (url, init) => {
      if (url === `${replacement.apiUrl}/v1/mobile-auth/session`) return new Response(null, { status: 204 });
      if (init?.method === "DELETE") {
        started.resolve();
        return response.promise;
      }
      return Response.json(session.user);
    });
    await logoutMobileSession(session);
    await started.promise;
    const retry = retryMobileSessionRevocations();
    native.storage.set(key, JSON.stringify(replacement));
    await logoutMobileSession(replacement);
    response.resolve(new Response(null, { status: 500 }));
    await retry;
    expect(native.fetch.mock.calls.map(([url, init]) => [url, init?.method ?? "GET"])).toEqual([
      [`${session.apiUrl}/v1/mobile-auth/session`, "DELETE"],
      [`${session.apiUrl}/v1/mobile-auth/session`, "GET"],
      [`${replacement.apiUrl}/v1/mobile-auth/session`, "DELETE"],
    ]);
    expect(JSON.parse(native.storage.get("openbot.mobile.pending-revocations.v1") ?? "null")).toEqual([
      { apiUrl: session.apiUrl, sessionToken: session.sessionToken },
    ]);
    expect(native.storage.has(key)).toBe(false);
  });

  it("does not restore a login if the app stopped after queuing sign-out", async () => {
    native.storage.set(
      "openbot.mobile.pending-revocations.v1",
      JSON.stringify([{ apiUrl: session.apiUrl, sessionToken: session.sessionToken }]),
    );
    native.fetch.mockRejectedValue(new TypeError("Network unavailable"));
    expect(await readMobileSession()).toBeNull();
    await retryMobileSessionRevocations();
    expect(native.storage.has(key)).toBe(false);
    expect(native.storage.has("openbot.mobile.pending-revocations.v1")).toBe(true);
  });

  it("allows a new QR login while the old account service is unreachable", async () => {
    native.storage.set("openbot.mobile.device-id.v1", "existing-device");
    const replacement = { ...session, apiUrl: "https://other.example.com", sessionToken: "replacement-token" };
    native.fetch.mockImplementation(async (url, init) => {
      if (url === `${replacement.apiUrl}/v1/mobile-auth/redeem` && init?.method === "POST") {
        return Response.json(replacement);
      }
      throw new TypeError("Old account service is unreachable");
    });
    await logoutMobileSession(session);
    await retryMobileSessionRevocations();
    const code = createMobileConnectUrl({ apiUrl: replacement.apiUrl, ticket: "t".repeat(32), host: session.host });
    expect(await redeemMobileConnectUrl(code)).toEqual(replacement);
    expect(await readMobileSession()).toEqual(replacement);
    await retryMobileSessionRevocations();
    expect(JSON.parse(native.storage.get("openbot.mobile.pending-revocations.v1") ?? "null")).toEqual([
      { apiUrl: session.apiUrl, sessionToken: session.sessionToken },
    ]);
  });

  it("removes a pending token when a lost response hides successful revocation", async () => {
    failNextLogout("network");
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    await logoutMobileSession(session);
    await retryMobileSessionRevocations();
    expect(native.storage.has(key)).toBe(false);
    expect(native.storage.has("openbot.mobile.pending-revocations.v1")).toBe(false);
    expect(native.fetch).toHaveBeenLastCalledWith(
      "https://api.openbot.run/v1/mobile-auth/session",
      expect.objectContaining({ headers: { Authorization: "Bearer test-session-token" } }),
    );
  });

  it("does not wait for the network or clear a replacement login", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    native.fetch.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    await logoutMobileSession(session);
    await started.promise;
    expect(native.storage.has(key)).toBe(false);
    const replacement = { ...session, sessionToken: "new-test-session-token" };
    native.storage.set(key, JSON.stringify(replacement));
    response.resolve(new Response(null, { status: 204 }));
    await retryMobileSessionRevocations();
    expect(await readMobileSession()).toEqual(replacement);
    expect(native.storage.has("openbot.mobile.pending-revocations.v1")).toBe(false);
  });

  it("preserves a login at another API with the same token", async () => {
    const replacement = { ...session, apiUrl: "https://other.example.com" };
    native.storage.set(key, JSON.stringify(replacement));
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 204 }));
    await logoutMobileSession(session);
    await retryMobileSessionRevocations();
    expect(await readMobileSession()).toEqual(replacement);
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
  it.each(["edit-first", "read-first", "restore-original"] as const)(
    "applies profile state in queue order (%s)",
    async (order) => {
      const started = Promise.withResolvers<void>();
      const firstResponse = Promise.withResolvers<Response>();
      let visible: MobileSession | null = session;
      const apply = (updated: MobileSession | null) => {
        visible = resolveSessionValidation(visible, session, updated);
      };
      native.fetch.mockImplementationOnce(() => {
        started.resolve();
        return firstResponse.promise;
      });
      const remoteUser = order === "restore-original" ? session.user : { ...session.user, name: "Newer remote name" };
      const editedUser = { ...session.user, name: "Saved name" };
      native.fetch.mockResolvedValueOnce(Response.json(order !== "read-first" ? remoteUser : editedUser));
      const first =
        order !== "read-first"
          ? updateMobileProfile(session, { name: "Saved name" }, apply)
          : validateMobileSession(session, apply);
      await started.promise;
      const second =
        order !== "read-first"
          ? validateMobileSession(session, apply)
          : updateMobileProfile(session, { name: "Saved name" }, apply);
      firstResponse.resolve(Response.json(order !== "read-first" ? editedUser : session.user));
      await Promise.all([first, second]);
      const expected = order !== "read-first" ? remoteUser : editedUser;
      expect(visible?.user).toEqual(expected);
      expect((await readMobileSession())?.user).toEqual(expected);
    },
  );

  it("applies expiry after an overlapping edit while protecting replacement logins and newer profiles", async () => {
    const started = Promise.withResolvers<void>();
    const response = Promise.withResolvers<Response>();
    native.fetch.mockImplementationOnce(() => {
      started.resolve();
      return response.promise;
    });
    native.fetch.mockResolvedValueOnce(new Response(null, { status: 401 }));
    const save = updateMobileProfile(session, { name: "Saved name" });
    await started.promise;
    const refresh = validateMobileSession(session);
    response.resolve(Response.json({ ...session.user, name: "Saved name" }));
    const edited = await save;
    const validated = await refresh;
    expect(validated).toBeNull();
    expect(await readMobileSession()).toBeNull();
    expect(resolveSessionValidation(edited, session, validated)).toBeNull();
    const newLogin = { ...edited, sessionToken: "new-token" };
    expect(resolveSessionValidation(newLogin, session, validated)).toBe(newLogin);
    const otherApi = { ...edited, apiUrl: "https://another.example.com" };
    expect(resolveSessionValidation(otherApi, session, validated)).toBe(otherApi);
    expect(resolveSessionValidation(null, session, session)).toBeNull();
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
