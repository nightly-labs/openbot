import { redactText } from "@openbot/logging";
import { afterEach, describe, expect, it, vi } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { type BitwardenCliRunner, BitwardenConnectorService, runBitwardenCli } from "./bitwarden-connector-service";

const KEY = "fixture-bitwarden-session-key";
const PASSWORD = "fixture-bitwarden-password";
const ID = "12345678-1234-1234-1234-123456789abc";
const ORIGIN = "https://example.com";
function login() {
  return {
    id: ID,
    name: "Example",
    folderId: "shared",
    type: 1,
    reprompt: 0,
    deletedDate: null,
    login: {
      username: "ada@example.com",
      password: PASSWORD,
      totp: "fixture-totp-seed",
      uris: [{ uri: `${ORIGIN}/login`, match: 0 }],
    },
  };
}
const services: BitwardenConnectorService[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await runCauseEffect(service.disconnect());
  vi.useRealTimers();
  vi.unstubAllEnvs();
});
function fixture() {
  const data = { item: login(), folders: [{ id: "shared", name: "Shared with OpenBot" }] };
  const run = vi.fn<BitwardenCliRunner>(async (_path, args) => {
    if (args[0] === "sync") return "Sync complete.";
    if (args[1] === "folders") return JSON.stringify(data.folders);
    if (args[1] === "items") return JSON.stringify([data.item]);
    if (args[1] === "item") return JSON.stringify(data.item);
    if (args[1] === "totp") return "739182\n";
    throw new Error("Unexpected command");
  });
  const service = new BitwardenConnectorService({ findCli: async () => "/fixture/bw", runCli: run });
  services.push(service);
  return { service, run, data };
}

describe("Bitwarden browser credentials", () => {
  it("returns metadata only, fills password and TOTP, and registers returned secrets", async () => {
    const { service } = fixture();
    expect(await runCauseEffect(service.connect(KEY))).toEqual({ connected: true });
    expect(await runCauseEffect(service.loginsFor(ORIGIN))).toEqual([
      { id: ID, title: "Example", username: "ada@example.com", hasOneTimePassword: true },
    ]);
    expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).toBe(PASSWORD);
    expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "totp"))).toBe("739182");
    expect(redactText(`${KEY} ${PASSWORD} 739182`)).not.toContain(PASSWORD);
    expect(redactText(KEY)).not.toContain(KEY);
    expect(redactText("739182")).not.toContain("739182");
  });

  it.each([
    "http://example.com",
    "https://evil.example.com",
    "https://example.com.evil.test",
    "https://example.com:8443",
  ])("does not fill %s", async (origin) => {
    const { service } = fixture();
    await runCauseEffect(service.connect(KEY));
    expect(await runCauseEffect(service.loginsFor(origin))).toEqual([]);
    expect(await runCauseEffect(service.secretFor(ID, origin, "password"))).toBeNull();
  });

  it.each(["folder", "origin", "prompt", "deleted", "never", "regex", "exact-path", "prefix"])(
    "checks current item policy after listing: %s",
    async (change) => {
      const { service, data, run } = fixture();
      await runCauseEffect(service.connect(KEY));
      expect(await runCauseEffect(service.loginsFor(ORIGIN))).toHaveLength(1);
      if (change === "folder") data.item.folderId = "private";
      if (change === "origin") data.item.login.uris = [{ uri: "https://other.test", match: 0 }];
      if (change === "prompt") data.item.reprompt = 1;
      if (change === "deleted") Object.assign(data.item, { deletedDate: "2026-10-07" });
      if (change === "never") data.item.login.uris = [{ uri: ORIGIN, match: 5 }];
      if (change === "regex") data.item.login.uris = [{ uri: ORIGIN, match: 4 }];
      if (change === "exact-path") data.item.login.uris = [{ uri: `${ORIGIN}/login`, match: 3 }];
      if (change === "prefix") data.item.login.uris = [{ uri: `${ORIGIN}/login`, match: 2 }];
      expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).toBeNull();
      expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "totp"))).toBeNull();
      expect(run.mock.calls.some((call) => call[1][1] === "totp")).toBe(false);
    },
  );

  it("requires exactly one shared folder", async () => {
    const { service, data } = fixture();
    data.folders = [];
    await expect(runCauseEffect(service.connect(KEY))).rejects.toThrow("Could not read Bitwarden");
    expect(service.connected()).toBe(false);
    data.folders = [
      { id: "a", name: "Shared with OpenBot" },
      { id: "b", name: "Shared with OpenBot" },
    ];
    await expect(runCauseEffect(service.connect(KEY))).rejects.toThrow("Could not read Bitwarden");
    expect(service.connected()).toBe(false);
  });

  it("does not expose CLI errors or malformed output", async () => {
    const { service, run } = fixture();
    run.mockRejectedValueOnce(new Error(`stderr: ${KEY} ${PASSWORD}`));
    await expect(runCauseEffect(service.connect(KEY))).rejects.toThrow("Could not read Bitwarden");
    await runCauseEffect(service.connect(KEY));
    run.mockResolvedValueOnce("Sync complete.").mockResolvedValueOnce(`invalid ${PASSWORD}`);
    await expect(runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).rejects.toThrow(
      /^Could not read Bitwarden\./u,
    );
  });

  it("discards a read that finishes after disconnect, and permits reconnect", async () => {
    const { service, run } = fixture();
    await runCauseEffect(service.connect(KEY));
    let release: (value: string) => void = () => {
      throw new Error("No pending read.");
    };
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(() => pending);
    const result = runCauseEffect(service.secretFor(ID, ORIGIN, "password"));
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    await runCauseEffect(service.disconnect());
    expect(run.mock.calls[2]?.[3].aborted).toBe(true);
    release(PASSWORD);
    await expect(result).rejects.toThrow("Could not read Bitwarden");
    expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).toBeNull();
    await runCauseEffect(service.connect("new-session-key"));
    expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).toBe(PASSWORD);
  });

  it("cancels a connection and does not reconnect from its late result", async () => {
    const { service, run } = fixture();
    let release: (value: string) => void = () => {
      throw new Error("No pending read.");
    };
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(() => pending);
    const result = runCauseEffect(service.connect(KEY));
    await vi.waitFor(() => expect(run).toHaveBeenCalledOnce());
    expect(service.connected()).toBe(false);
    await runCauseEffect(service.disconnect());
    release("Sync complete.");
    await expect(result).rejects.toThrow("Could not read Bitwarden");
    expect(service.connected()).toBe(false);
  });

  it("waits for a cancelled child before disposal finishes", async () => {
    const { service, run } = fixture();
    await runCauseEffect(service.connect(KEY));
    let release: (value: string) => void = () => {
      throw new Error("No pending read.");
    };
    const pending = new Promise<string>((resolve) => {
      release = resolve;
    });
    run.mockImplementationOnce(() => pending);
    const read = runCauseEffect(service.secretFor(ID, ORIGIN, "password")).catch(() => null);
    await vi.waitFor(() => expect(run).toHaveBeenCalledTimes(3));
    let disposed = false;
    const stopping = runCauseEffect(service.dispose()).then(() => {
      disposed = true;
    });
    await vi.waitFor(() => expect(run.mock.calls[2]?.[3].aborted).toBe(true));
    expect(service.connected()).toBe(false);
    expect(disposed).toBe(false);
    release("Sync complete.");
    await stopping;
    expect(await read).toBeNull();
  });

  it("expires after eight idle hours and starts disconnected in a new service", async () => {
    vi.useFakeTimers();
    const { service } = fixture();
    await runCauseEffect(service.connect(KEY));
    await vi.advanceTimersByTimeAsync(8 * 60 * 60 * 1000);
    expect(service.connected()).toBe(false);
    expect(await runCauseEffect(service.secretFor(ID, ORIGIN, "password"))).toBeNull();
    expect(fixture().service.connected()).toBe(false);
  });

  it("passes the key only in the clean child environment and hides child stderr", async () => {
    vi.stubEnv("NODE_OPTIONS", "--invalid-openbot-fixture-option");
    vi.stubEnv("OPENAI_API_KEY", "must-not-reach-child");
    const signal = new AbortController().signal;
    const output = await runBitwardenCli(
      process.execPath,
      [
        "-e",
        "process.stdout.write(JSON.stringify({key:process.env.BW_SESSION, injected:process.env.NODE_OPTIONS, credential:process.env.OPENAI_API_KEY, args:process.argv.slice(1)}))",
      ],
      KEY,
      signal,
    );
    expect(JSON.parse(output)).toEqual({ key: KEY, args: [] });
    await expect(
      runBitwardenCli(
        process.execPath,
        ["-e", "process.stderr.write(process.env.BW_SESSION);process.exit(1)"],
        KEY,
        signal,
      ),
    ).rejects.toThrow(/^Could not read Bitwarden\./u);
  });
});
