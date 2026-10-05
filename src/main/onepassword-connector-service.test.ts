// @vitest-environment node
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  type OnePasswordClient,
  type OnePasswordCliRunner,
  OnePasswordConnectorService,
} from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";

const TOKEN = "ops_service-account-token-for-tests";
const PASSWORD = "vault-only-hunter2";
/** Reverses the text, so the file on disk never holds the token as written. */
const cipher = {
  encrypt: (value: string) => Buffer.from([...value].reverse().join("")),
  decrypt: (value: Buffer) => [...value.toString()].reverse().join(""),
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-onepassword-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

type Websites = Array<{ url: string; autofillBehavior: string }>;

/** `current` is the item as 1Password holds it now; the list keeps what it held when indexed. */
function fakeClient(current: { websites?: () => Websites; get?: <T>(item: T) => Promise<T> } = {}): OnePasswordClient {
  const indexed: Websites = [{ url: "https://github.com", autofillBehavior: "AnywhereOnWebsite" }];
  return {
    vaults: { list: async () => [{ id: "vault-1", title: "Shared with OpenBot" }] },
    items: {
      list: async () => [{ id: "login-1", title: "GitHub", category: "Login", websites: indexed }],
      get: async () => {
        const item = {
          websites: current.websites?.() ?? indexed,
          fields: [
            { id: "username", fieldType: "Text", value: "ada" },
            { id: "password", fieldType: "Concealed", value: PASSWORD },
          ],
        };
        return current.get ? current.get(item) : item;
      },
    },
  };
}

function fakeCli(accounts: Array<{ account_uuid: string; email: string; url: string }>) {
  return vi.fn<OnePasswordCliRunner>(async (_executable, args) => {
    const command = args.slice(0, 2).join(" ");
    if (args[0] === "--version") return "2.30.0\n";
    if (command === "account list") return JSON.stringify(accounts);
    if (command === "vault list") return "[]";
    if (command === "vault create") return JSON.stringify({ id: "vault-1", name: "Shared with OpenBot" });
    if (command === "service-account create") return `${TOKEN}\n`;
    throw new Error(`Unexpected command: ${args.join(" ")}`);
  });
}

function service(
  runCli: OnePasswordCliRunner,
  options: {
    createClient?: (token: string) => Promise<OnePasswordClient>;
    findCli?: () => Promise<string[]>;
    installCli?: (signal: AbortSignal) => Promise<unknown>;
    store?: (path: string) => OnePasswordConnectorStore;
  } = {},
) {
  const path = join(directory, "connector.json");
  return {
    path,
    connector: new OnePasswordConnectorService({
      store: options.store?.(path) ?? new OnePasswordConnectorStore(path, cipher),
      hostName: "test-mac",
      appVersion: "1.0.0",
      cliInstall: null,
      openExternal: async () => undefined,
      findCli: options.findCli ?? (async () => ["/usr/local/bin/op"]),
      runCli,
      installCli: options.installCli,
      createClient: options.createClient ?? (async () => fakeClient()),
    }),
  };
}

describe("OnePasswordConnectorService", () => {
  it("creates a read-only service account for the shared vault and keeps only its token", async () => {
    const cli = fakeCli([{ account_uuid: "account-1", email: "ada@example.com", url: "my.1password.com" }]);
    const { connector, path } = service(cli);

    const status = await connector.connect({ accountId: null });

    expect(status).toMatchObject({ state: "connected", vaultNames: ["Shared with OpenBot"], loginCount: 1 });
    expect(JSON.stringify(status)).not.toContain(TOKEN);
    const create = cli.mock.calls.find(([, args]) => args[0] === "service-account")?.[1];
    expect(create).toEqual(expect.arrayContaining(["--vault", "vault-1:read_items", "--account", "account-1"]));
    expect(await readFile(path, "utf8")).not.toContain(TOKEN);
  });

  it("asks for an account before it creates anything when the CLI has several", async () => {
    const cli = fakeCli([
      { account_uuid: "account-1", email: "ada@example.com", url: "my.1password.com" },
      { account_uuid: "account-2", email: "ada@example.org", url: "example.1password.com" },
    ]);
    const { connector } = service(cli);

    const status = await connector.connect({ accountId: null });

    expect(status.state).toBe("choose-account");
    expect(status.accounts.map((account) => account.id)).toEqual(["account-1", "account-2"]);
    expect(cli.mock.calls.some(([, args]) => args[0] === "vault" || args[0] === "service-account")).toBe(false);
  });

  it("gives a password only for a site that the login is saved for", async () => {
    const { connector } = service(fakeCli([]));
    await connector.connectWithToken(TOKEN);

    expect(await connector.secretFor("login-1", "https://evilgithub.com", "password")).toBeNull();
    expect(await connector.secretFor("login-1", "https://github.com", "password")).toBe(PASSWORD);
    expect(await connector.loginsFor("https://github.com")).toEqual([
      { id: "login-1", title: "GitHub", username: "ada", hasOneTimePassword: false },
    ]);
  });

  it("gives no password once 1Password no longer saves the login for that site", async () => {
    let websites: Websites = [{ url: "https://github.com", autofillBehavior: "AnywhereOnWebsite" }];
    const client = fakeClient({ websites: () => websites });
    const { connector } = service(fakeCli([]), { createClient: async () => client });
    await connector.connectWithToken(TOKEN);

    // The index is still fresh and lists github.com; the user has since set the login to Never.
    websites = [{ url: "https://github.com", autofillBehavior: "Never" }];

    expect(await connector.secretFor("login-1", "https://github.com", "password")).toBeNull();
    expect(await connector.loginsFor("https://github.com")).toEqual([]);
  });

  it("drops a password that 1Password sends after Disconnect", async () => {
    let release: (() => void) | undefined;
    let pending = false;
    const client = fakeClient({
      get: (item) => {
        if (!pending) return Promise.resolve(item);
        return new Promise((resolve) => {
          release = () => resolve(item);
        });
      },
    });
    const { connector } = service(fakeCli([]), { createClient: async () => client });
    await connector.connectWithToken(TOKEN);
    pending = true;

    const secret = connector.secretFor("login-1", "https://github.com", "password");
    await vi.waitFor(() => expect(release).toBeDefined());
    await connector.disconnect();
    release?.();

    expect(await secret).toBeNull();
  });

  it("gives no password to a read that starts while Disconnect removes the file", async () => {
    const { connector } = service(fakeCli([]));
    await connector.connectWithToken(TOKEN);

    const disconnecting = connector.disconnect();
    expect(await connector.secretFor("login-1", "https://github.com", "password")).toBeNull();
    await disconnecting;
  });

  it("keeps no token when Cancel arrives while the token is being stored", async () => {
    let unblock: (() => void) | undefined;
    const gate = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    let writing = false;
    class SlowStore extends OnePasswordConnectorStore {
      override async write(...args: Parameters<OnePasswordConnectorStore["write"]>): Promise<boolean> {
        writing = true;
        await gate;
        return super.write(...args);
      }
    }
    const { connector, path } = service(fakeCli([]), { store: (file) => new SlowStore(file, cipher) });

    const connecting = connector.connectWithToken(TOKEN);
    await vi.waitFor(() => expect(writing).toBe(true));
    connector.cancel();
    unblock?.();

    expect((await connecting).state).toBe("disconnected");
    expect(await connector.loginsFor("https://github.com")).toBeNull();
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("stores no token whose check finishes after Disconnect", async () => {
    let accept: (() => void) | undefined;
    const { connector, path } = service(fakeCli([]), {
      createClient: () =>
        new Promise((resolve) => {
          accept = () => resolve(fakeClient());
        }),
    });

    const connecting = connector.connectWithToken(TOKEN);
    await vi.waitFor(() => expect(accept).toBeDefined());
    await connector.disconnect();
    accept?.();

    expect((await connecting).state).toBe("disconnected");
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("stores nothing when 1Password refuses the token", async () => {
    const { connector, path } = service(fakeCli([]), {
      createClient: async () => {
        throw new Error("invalid token");
      },
    });

    const status = await connector.connectWithToken(TOKEN);

    expect(status.state).toBe("disconnected");
    expect(status.error).toBe("1Password did not accept the service account token.");
    expect(await connector.loginsFor("https://github.com")).toBeNull();
    await expect(readFile(path, "utf8")).rejects.toThrow();
  });

  it("reads the login list again when the page opens, so a login moved into the vault is counted", async () => {
    let logins = 1;
    let now = 0;
    const client = fakeClient();
    const list = client.items.list;
    client.items.list = async (vaultId) => (await list(vaultId)).slice(0, logins);
    const path = join(directory, "connector.json");
    const connector = new OnePasswordConnectorService({
      store: new OnePasswordConnectorStore(path, cipher),
      hostName: "test-mac",
      appVersion: "1.0.0",
      cliInstall: null,
      openExternal: async () => undefined,
      findCli: async () => [],
      runCli: fakeCli([]),
      createClient: async () => client,
      now: () => now,
    });
    await connector.connectWithToken(TOKEN);
    logins = 0;
    now = 60_000;
    const changed: number[] = [];
    connector.onChanged((status) => {
      if (status.loginCount !== null) changed.push(status.loginCount);
    });

    await connector.checkSetup();

    await vi.waitFor(() => expect(changed).toContain(0));
  });

  it("walks the setup from no CLI, through Install, to an app integration that is off", async () => {
    let installed = false;
    const { connector } = service(fakeCli([]), {
      findCli: async () => (installed ? ["/openbot/1password-cli/2.39.0/op"] : []),
      installCli: async () => {
        installed = true;
      },
    });

    expect((await connector.checkSetup()).setup).toEqual({
      cli: "missing",
      cliVersion: null,
      canInstall: true,
      appIntegration: null,
    });
    expect((await connector.installCli()).setup).toEqual({
      cli: "ready",
      cliVersion: "2.30.0",
      canInstall: true,
      appIntegration: false,
    });
  });
});
