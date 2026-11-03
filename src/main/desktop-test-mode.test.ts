import { Effect } from "effect";
import { describe, expect, it, vi } from "vitest";
import { CentralAuthManager } from "./central-auth-manager";
import { admitDesktopTest, desktopTestPaths, desktopTestRequestAllowed } from "./desktop-test-mode";
import { handleTrusted, setDesktopTestRequestGuard } from "./trusted-ipc";

const { registrations, readFile } = vi.hoisted(() => ({
  registrations: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
  readFile: vi.fn(() => {
    throw new Error("Unexpected credential read");
  }),
}));
vi.mock("electron", () => ({
  ipcMain: {
    handle: (channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) =>
      registrations.set(channel, handler),
  },
}));
vi.mock("node:fs/promises", async (original) => ({
  ...(await original<typeof import("node:fs/promises")>()),
  readFile,
}));

const root = "/private/tmp/truesmac-desktop-test-unit";

describe("desktop test admission", () => {
  it("places every root below a fresh canonical temporary directory", () => {
    const writes: string[] = [];
    const paths = Effect.runSync(
      admitDesktopTest(root, false, {
        temporaryRoot: () => "/private/tmp",
        createDirectory: (path: string) => {
          writes.push(path);
        },
      }),
    );
    expect(writes).toEqual([root, `${root}/profile`, `${root}/workspaces`, `${root}/tmp`]);
    expect(paths).toEqual({ root, profile: writes[1], workspaces: writes[2], temporary: writes[3] });
  });
  it.each([
    "",
    "relative",
    "/Users/example/Library/Application Support/OpenBot",
    "/private/tmp",
    `${root}/../truesmac-desktop-test-unit`,
    "/tmp/truesmac-desktop-test-unit",
    `${root}/child`,
  ])("refuses unsafe root %s before writing", (path) => {
    const write = vi.fn();
    expect(() =>
      Effect.runSync(admitDesktopTest(path, false, { temporaryRoot: () => "/private/tmp", createDirectory: write })),
    ).toThrow();
    expect(write).not.toHaveBeenCalled();
  });
  it("refuses packaged applications and existing roots, including symlinks, without child writes", () => {
    expect(() => desktopTestPaths(root, "/private/tmp", true)).toThrow();
    const writes: string[] = [];
    expect(() =>
      Effect.runSync(
        admitDesktopTest(root, false, {
          temporaryRoot: () => "/private/tmp",
          createDirectory: (path: string) => {
            writes.push(path);
            throw Object.assign(new Error("exists"), { code: "EEXIST" });
          },
        }),
      ),
    ).toThrow();
    expect(writes).toEqual([root]);
  });
});

describe("offline account startup", () => {
  it("reaches signed-out without reading credentials, querying keychain or probing network", async () => {
    const credential = vi.fn(() => {
      throw new Error("Unexpected credential operation");
    });
    const network = vi.fn(async () => {
      throw new Error("Unexpected network");
    });
    const auth = new CentralAuthManager({
      offline: true,
      apiUrl: "https://synthetic.invalid",
      storagePath: "/synthetic-only/session",
      encrypt: credential,
      decrypt: credential,
      canPersist: credential,
      fetch: network,
    });
    expect(await Effect.runPromise(auth.initialize())).toEqual({ status: "signed_out" });
    expect(await Effect.runPromise(auth.retry())).toEqual({ status: "signed_out" });
    expect(auth.getState()).toEqual({ status: "signed_out" });
    expect(readFile).not.toHaveBeenCalled();
    expect(credential).not.toHaveBeenCalled();
    expect(network).not.toHaveBeenCalled();
    await Effect.runPromise(auth.dispose());
  });
});

describe("test-mode IPC boundary", () => {
  it("preserves production dispatch before opt-in and denies actions before decoding after opt-in", () => {
    const handled = vi.fn(() => "normal");
    handleTrusted("provider:start", handled);
    const trusted = { senderFrame: { url: "openbot-app://app/index.html" } };
    expect(registrations.get("provider:start")?.(trusted)).toBe("normal");
    handled.mockClear();
    setDesktopTestRequestGuard(desktopTestRequestAllowed);
    const decode = vi.fn((value: unknown) => String(value));
    handleTrusted("provider:start", decode, handled);
    for (const channel of [
      "provider:start",
      "app:save-setup",
      "auth:sign-in",
      "unknown:new-action",
      "browser:open",
      "host:start",
    ]) {
      expect(desktopTestRequestAllowed(channel)).toBe(false);
      handleTrusted(channel, decode, handled);
      expect(() => registrations.get(channel)?.(trusted, "synthetic")).toThrow("disabled in desktop test mode");
    }
    expect(decode).not.toHaveBeenCalled();
    expect(handled).not.toHaveBeenCalled();
    handleTrusted("auth:get-state", () => "signed_out");
    expect(registrations.get("auth:get-state")?.(trusted)).toBe("signed_out");
    expect(() => registrations.get("auth:get-state")?.({ senderFrame: { url: "https://synthetic.invalid" } })).toThrow(
      "untrusted renderer",
    );
    expect(() => setDesktopTestRequestGuard(() => true)).toThrow();
  });
});
