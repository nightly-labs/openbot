import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { McpOAuthRecord } from "../backend/mcp-oauth-provider";
import { McpOAuthStore } from "./mcp-oauth-store";

/** The same reversible stand-in for `safeStorage` the provider key file's test uses. */
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join(""), "utf8"),
  decrypt: (value: Buffer) => [...value.toString("utf8")].reverse().join(""),
};

const LINEAR = "https://mcp.linear.app/mcp";
const NOTION = "https://mcp.notion.com/mcp";

function record(accessToken: string): McpOAuthRecord {
  return {
    client: { client_id: "client-abc", redirect_uris: ["openbot://mcp-auth"] },
    tokens: { access_token: accessToken, token_type: "Bearer", refresh_token: "refresh-xyz", expires_in: 3600 },
    obtainedAt: 1_700_000_000_000,
  };
}

async function createStore(): Promise<{ path: string; store: McpOAuthStore }> {
  const root = await mkdtemp(join(tmpdir(), "openbot-mcp-oauth-"));
  const path = join(root, "mcp-oauth.json");
  const store = new McpOAuthStore(path, cipher);
  await store.load();
  return { path, store };
}

describe("McpOAuthStore", () => {
  it("reads back a saved sign-in in a new store", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));

    const reopened = new McpOAuthStore(path, cipher);
    expect(await reopened.load()).toBeNull();
    expect(reopened.read(LINEAR)).toEqual(record("linear-access"));
    expect(reopened.read(NOTION)).toBeNull();
  });

  it("writes no token to disk", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));

    // The file is what a backup tool or a support bundle picks up. `mcp-remote` kept these tokens
    // where OpenBot could not redact them; the point of holding them here is that it can.
    const source = await readFile(path, "utf8");
    expect(source).not.toContain("linear-access");
    expect(source).not.toContain("refresh-xyz");
    expect(JSON.parse(source)).toMatchObject({ version: 1 });
  });

  it.runIf(process.platform !== "win32")("keeps the file readable only by its owner", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));

    expect((await stat(path)).mode & 0o777).toBe(0o600);
  });

  it("forgets one server and keeps the others", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));
    await store.write(NOTION, record("notion-access"));

    await store.clear(LINEAR);
    const reopened = new McpOAuthStore(path, cipher);
    await reopened.load();
    expect(reopened.read(LINEAR)).toBeNull();
    expect(reopened.read(NOTION)).toEqual(record("notion-access"));
  });

  it("keeps both tokens when two servers refresh at once", async () => {
    const { path, store } = await createStore();
    // One hand-off resolves every server together, so two expiring tokens are refreshed side by
    // side. Each change copies the records before it writes: unqueued, the second copy is taken
    // before the first commit and the rotated token of one server is written away by the other.
    await Promise.all([store.write(LINEAR, record("linear-access")), store.write(NOTION, record("notion-access"))]);

    const reopened = new McpOAuthStore(path, cipher);
    expect(await reopened.load()).toBeNull();
    expect(reopened.read(LINEAR)).toEqual(record("linear-access"));
    expect(reopened.read(NOTION)).toEqual(record("notion-access"));
  });

  it("treats an empty record as no record at all", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));

    // How `invalidateCredentials("all")` arrives: nothing about the server is left to keep.
    await store.write(LINEAR, {});
    const reopened = new McpOAuthStore(path, cipher);
    await reopened.load();
    expect(reopened.read(LINEAR)).toBeNull();
  });

  it("reports an envelope it cannot understand, and leaves it on disk", async () => {
    const { path } = await createStore();
    // Startup continues past this file: an unreadable sign-in must not stop the app, and it must
    // not be read as "never signed in" and then written over by an unrelated server's sign-in.
    for (const envelope of [{ version: 2, servers: {} }, { version: 1, servers: { [LINEAR]: 7 } }, "not json"]) {
      const source = typeof envelope === "string" ? envelope : JSON.stringify(envelope);
      await writeFile(path, source, "utf8");
      const store = new McpOAuthStore(path, cipher);

      expect(await store.load()).toBeInstanceOf(Error);
      expect(store.read(LINEAR)).toBeNull();
      expect(await readFile(path, "utf8")).toBe(source);
    }
  });

  it("replaces an unreadable envelope with the sign-in the user just finished", async () => {
    const { path } = await createStore();
    await writeFile(path, "not json", "utf8");
    const store = new McpOAuthStore(path, cipher);
    await store.load();

    await store.write(NOTION, record("notion-access"));
    const reopened = new McpOAuthStore(path, cipher);
    expect(await reopened.load()).toBeNull();
    expect(reopened.read(NOTION)).toEqual(record("notion-access"));
  });

  it("changes nothing when a write cannot be encrypted", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("first-access"));
    // The file is the source of truth for a hand-off: a token held only in memory would reach a
    // provider process after a failed save, and the next start would send a token nobody stored.
    const failing = new McpOAuthStore(path, {
      ...cipher,
      encrypt: () => {
        throw new Error("System secret storage is unavailable.");
      },
    });
    await failing.load();

    await expect(failing.write(NOTION, record("notion-access"))).rejects.toThrow(
      "System secret storage is unavailable.",
    );
    expect(failing.read(NOTION)).toBeNull();
    expect(failing.read(LINEAR)).toEqual(record("first-access"));
  });

  it("keeps the previous envelope when a write did not finish", async () => {
    const { path, store } = await createStore();
    await store.write(LINEAR, record("linear-access"));
    // What a crash between the temporary write and the rename leaves behind. A partial write must
    // not cost the user the sign-in they already completed.
    await writeFile(`${path}.tmp`, '{"version":1,"serv', "utf8");

    const reopened = new McpOAuthStore(path, cipher);
    await reopened.load();
    expect(reopened.read(LINEAR)).toEqual(record("linear-access"));
  });

  it("refuses to report a sign-in before it is loaded", async () => {
    const root = await mkdtemp(join(tmpdir(), "openbot-mcp-oauth-"));
    // Reporting "not signed in" here would send a provider an http server with no credential, and
    // the tools would go missing for a reason that looks like the server's fault.
    expect(() => new McpOAuthStore(join(root, "mcp-oauth.json"), cipher).read(LINEAR)).toThrow();
  });
});
