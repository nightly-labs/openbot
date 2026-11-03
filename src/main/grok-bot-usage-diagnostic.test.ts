// @vitest-environment node
// Protected secret-redaction checks at the main-process diagnostic/log boundary.
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { translateFor } from "@openbot/i18n";
import { teeLogLines } from "@openbot/logging";
import { Effect } from "effect";
import type { MenuItemConstructorOptions } from "electron";
import { afterEach, expect, it, vi } from "vitest";
import { GrokBotAccountService } from "./grok-bot-account-service";
import { configureApplicationMenu } from "./main-window";

const { menus } = vi.hoisted(() => {
  const menus: MenuItemConstructorOptions[][] = [];
  return { menus };
});
vi.mock("electron", () => ({
  BrowserWindow: class {},
  session: {},
  shell: {},
  app: {},
  screen: {},
  clipboard: {},
  webContents: {},
  nativeTheme: {},
  Menu: {
    buildFromTemplate: (menu: MenuItemConstructorOptions[]) => {
      menus.push(menu);
      return {};
    },
    setApplicationMenu() {},
  },
}));
afterEach(() => vi.unstubAllGlobals());
const PRIVATE = "unregistered-transcript-private-fixture";
const ID = "private-agent-id";
const NONCE = "private-prompt-nonce";
const ECHO = "private-echo-entry-id";
async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "openbot-diagnostic-log-"));
  let decrypted = 0;
  const service = new GrokBotAccountService({
    path: join(directory, "account.json"),
    getMainWindow: () => null,
    cipher: {
      encrypt: (value) => Buffer.from(value),
      decrypt: (value) => {
        decrypted += 1;
        return value.toString("utf8");
      },
    },
  });
  const store = service.accountStore();
  await Effect.runPromise(
    store.save({
      accessToken: "registered-access-secret",
      refreshToken: "registered-refresh-secret",
      gateway: { url: "http://127.0.0.1:1340", token: "registered-gateway-secret", headers: {} },
    }),
  );
  await Effect.runPromise(store.load());
  return { service, store, decrypts: () => decrypted };
}
it("logs only allowlisted status/shape evidence, with no raw identifiers, transcript or provider error text", async () => {
  const { service, decrypts } = await fixture();
  const calls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url) => {
      const path = new URL(String(url)).pathname;
      calls.push(path);
      const body =
        path === "/api/listAgents"
          ? { agents: [{ id: ID, name: PRIVATE, token: PRIVATE }] }
          : path === "/api/getAgentRunHistory"
            ? {
                agentId: ID,
                runs: [
                  {
                    requestId: PRIVATE,
                    detail: PRIVATE,
                    usage: { requests: 1, inputTokens: 20, outputTokens: 3, cacheReadTokens: 10 },
                  },
                ],
              }
            : path === "/api/getAgentTranscriptTail"
              ? { entries: [{ role: "user", id: ECHO, clientNonce: NONCE, text: PRIVATE, attachment: PRIVATE }] }
              : {
                  outcome: "found",
                  record: { clientNonce: NONCE, agentId: ID, echoEntryId: ECHO, inputDigest: PRIVATE },
                };
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  const lines: string[] = [];
  const stop = teeLogLines(["grok-bot-cached-usage-diagnostic"], (line) => lines.push(line));
  try {
    const before = decrypts();
    await Effect.runPromise(service.diagnoseCachedUsage(false));
    expect(calls).toHaveLength(0);
    expect(lines).toHaveLength(0);
    await Effect.runPromise(service.diagnoseCachedUsage(true));
    expect(decrypts()).toBe(before);
    expect(calls).toHaveLength(4);
    expect(lines).toHaveLength(1);
    for (const value of [
      PRIVATE,
      ID,
      NONCE,
      ECHO,
      "registered-access-secret",
      "registered-refresh-secret",
      "registered-gateway-secret",
      "fixture.cursorvm.com",
      "[redacted]",
    ])
      expect(lines[0]).not.toContain(value);
    expect(lines[0]).toContain('"nonceEchoMatched":true');
    expect(lines[0]).toContain('"runNonceExactMatch":null');
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error(PRIVATE);
      }),
    );
    await Effect.runPromise(service.diagnoseCachedUsage(true));
    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('"status":"network-error"');
    expect(lines[1]).not.toContain(PRIVATE);
  } finally {
    stop();
    await service.dispose();
  }
});
it.each(["sign-out", "dispose"] as const)(
  "cancels on %s, prevents overlapping reads and keeps private causes out of logs",
  async (operation) => {
    const { service, store, decrypts } = await fixture();
    let started = () => {};
    const firstRequest = new Promise<void>((ready) => {
      started = ready;
    });
    const fetcher = vi.fn(
      (_url, init) =>
        new Promise<Response>((_ready, reject) => {
          init.signal.addEventListener("abort", () => reject(new Error(PRIVATE)), { once: true });
          started();
        }),
    );
    vi.stubGlobal("fetch", fetcher);
    const lines: string[] = [];
    const stop = teeLogLines(["grok-bot-cached-usage-diagnostic"], (line) => lines.push(line));
    try {
      const before = decrypts();
      const pending = Effect.runPromise(service.diagnoseCachedUsage(true));
      await firstRequest;
      await Effect.runPromise(service.diagnoseCachedUsage(true));
      expect(fetcher).toHaveBeenCalledTimes(1);
      if (operation === "sign-out") await Effect.runPromise(service.signOut());
      else await service.dispose();
      await pending;
      expect(decrypts()).toBe(before);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(store.cachedGateway().state).toBe(operation === "sign-out" ? "signed-out" : "not-loaded");
      expect(lines).toHaveLength(1);
      expect(lines[0]).toContain('"status":"cancelled"');
      expect(lines[0]).not.toContain(PRIVATE);
    } finally {
      stop();
      await service.dispose();
    }
  },
);
it("keeps the privileged diagnostic absent by default and never starts it while constructing the native menu", () => {
  const unrelated = () => {
    throw new Error("An unrelated native action ran");
  };
  const translate = translateFor("en");
  const label = translate("menu.grokBotUsageDiagnostic");
  const service = { interruptAll: unrelated };
  const updater = { checkForUpdates: unrelated };
  const interfaceSize = { step: unrelated };
  let called = 0;
  const quit = () => undefined;
  configureApplicationMenu(service, updater, interfaceSize, translate, () => null, quit);
  const defaultView = menus.at(-1)?.find((item) => item.role === "viewMenu");
  expect(Array.isArray(defaultView?.submenu) && defaultView.submenu.some((item) => item.label === label)).toBe(false);
  const run = () => {
    called += 1;
  };
  configureApplicationMenu(service, updater, interfaceSize, translate, () => null, quit, run);
  expect(called).toBe(0);
  const view = menus.at(-1)?.find((item) => item.role === "viewMenu");
  const action = Array.isArray(view?.submenu) ? view.submenu.find((item) => item.label === label) : undefined;
  expect(action).toBeDefined();
  expect(action?.click).toBe(run);
  run();
  expect(called).toBe(1);
});
