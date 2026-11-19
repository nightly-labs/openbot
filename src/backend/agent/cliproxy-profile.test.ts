import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CLIPROXY_DEFAULT_BASE_URL, cliProxyDefaultLabel, normalizeCliProxyBaseUrl } from "@openbot/contracts/ipc";
import { Effect, Scope } from "effect";
import { afterEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../effect-boundary";
import { claudeAgentEnvironment, codexVariableOverrides } from "../provider-drivers";
import { ProviderAccountStore } from "./provider-account-store";
import { cliProxyEnvironment, ProviderAccounts, type ProviderAccountsHost } from "./provider-accounts";

const tempDirs: string[] = [];

afterEach(async () => {
  for (const dir of tempDirs.splice(0)) {
    await rm(dir, { recursive: true, force: true });
  }
});

async function createHarness() {
  const root = await mkdtemp(join(tmpdir(), "openbot-cliproxy-test-"));
  tempDirs.push(root);
  const storePath = join(root, "provider-accounts.json");
  const homesDir = join(root, "homes");
  const store = new ProviderAccountStore(storePath, homesDir);
  await runCauseEffect(store.load());

  const keys = new Map<string, string>();
  let changedCalls = 0;
  const stoppedClients: Array<{ provider: string; accountId: string }> = [];
  const scope = Scope.makeUnsafe();

  const host: ProviderAccountsHost = {
    scope: () => scope,
    cli: (provider) =>
      provider === "claude" || provider === "codex" || provider === "antigravity"
        ? {
            executable: provider,
            version: "1.6.0",
            source: "managed",
            pathEntries: [],
          }
        : undefined,
    defaultLogin: () => ({ email: "native@example.com", organization: null }),
    apiKey: () => null,
    accountKey: (provider, accountId) => keys.get(`${provider}:${accountId}`) ?? null,
    saveAccountKey: (provider, accountId, key) =>
      Effect.sync(() => {
        const k = `${provider}:${accountId}`;
        if (key === null) keys.delete(k);
        else keys.set(k, key);
      }),
    defaultUsesApiKey: () => false,
    signInTemp: () => undefined,
    authenticate: () => Effect.die("authenticate should not run for CLIProxy profiles"),
    stopClient: () => Effect.void,
    agentClient: () => null,
    isAccountBusy: () => false,
    stopAgentClients: (provider, accountId) =>
      Effect.sync(() => {
        stoppedClients.push({ provider, accountId });
      }),
    readUsage: () => Effect.succeed({ limits: [] }),
    readModels: () => Effect.succeed([]),
    resetCredits: () => null,
    consumeUsageReset: () => Effect.succeed("nothingToReset" as const),
    changed: () => {
      changedCalls += 1;
    },
    usageChanged: () => undefined,
    redact: (text) => text,
  };

  const accounts = new ProviderAccounts(store, host);
  return {
    root,
    storePath,
    homesDir,
    store,
    accounts,
    keys,
    getChangedCalls: () => changedCalls,
    getStoppedClients: () => stoppedClients,
  };
}

describe("CLIProxy dedicated provider profiles", () => {
  it("normalizes and validates CLIProxy URLs", () => {
    expect(normalizeCliProxyBaseUrl(" http://127.0.0.1:8317/// ")).toBe(CLIPROXY_DEFAULT_BASE_URL);
    expect(normalizeCliProxyBaseUrl("https://proxy.example.com/v1/")).toBe("https://proxy.example.com/v1");
    expect(normalizeCliProxyBaseUrl("ftp://127.0.0.1:8317")).toBeNull();
    expect(normalizeCliProxyBaseUrl("http://127.0.0.1:8317/bad path")).toBeNull();
    expect(normalizeCliProxyBaseUrl("   ")).toBeNull();
  });

  it("creates, persists, isolates env, edits, and removes CLIProxy profiles without storing keys in JSON", async () => {
    const h = await createHarness();

    // Create dedicated CLIProxy profiles for Claude, Codex, and Antigravity.
    const claude = await runCauseEffect(
      h.accounts.saveCliProxyProfile({
        provider: "claude",
        accountId: null,
        baseUrl: "http://127.0.0.1:8317/",
        apiKey: "secret-claude-proxy-key",
      }),
    );
    const codex = await runCauseEffect(
      h.accounts.saveCliProxyProfile({
        provider: "codex",
        accountId: null,
        label: "Codex Local Proxy",
        baseUrl: "http://127.0.0.1:8317",
        apiKey: "secret-codex-proxy-key",
      }),
    );
    const antigravity = await runCauseEffect(
      h.accounts.saveCliProxyProfile({
        provider: "antigravity",
        accountId: null,
        baseUrl: "https://agy-proxy.local:8443",
      }),
    );

    expect(claude.label).toBe(cliProxyDefaultLabel("claude"));
    expect(codex.label).toBe("Codex Local Proxy");
    expect(antigravity.label).toBe(cliProxyDefaultLabel("antigravity"));

    // Verify JSON store persists proxy metadata but NEVER contains any API key.
    const rawJson = await readFile(h.storePath, "utf8");
    expect(rawJson).toContain("http://127.0.0.1:8317");
    expect(rawJson).not.toContain("secret-claude-proxy-key");
    expect(rawJson).not.toContain("secret-codex-proxy-key");

    // Reloading into a fresh ProviderAccountStore preserves proxy metadata cleanly.
    const reloaded = new ProviderAccountStore(h.storePath, h.homesDir);
    await runCauseEffect(reloaded.load());
    expect(reloaded.get("claude", claude.id)?.proxy).toEqual({ kind: "cliproxy", baseUrl: "http://127.0.0.1:8317" });

    // Per-provider isolated environment includes isolated home dir + proxy URL + encrypted token.
    const claudeEnv = h.accounts.environment(claude);
    expect(claudeEnv.CLAUDE_CONFIG_DIR).toContain(claude.id);
    expect(claudeEnv.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8317");
    expect(claudeEnv.ANTHROPIC_AUTH_TOKEN).toBe("secret-claude-proxy-key");

    const codexEnv = h.accounts.environment(codex);
    expect(codexEnv.CODEX_HOME).toContain(codex.id);
    expect(codexEnv.OPENAI_BASE_URL).toBe("http://127.0.0.1:8317");
    expect(codexEnv.OPENAI_API_KEY).toBe("secret-codex-proxy-key");

    const agyEnv = h.accounts.environment(antigravity);
    expect(agyEnv.GEMINI_HOME).toContain(antigravity.id);
    expect(agyEnv.AGY_LLM_GATEWAY_URL).toBe("https://agy-proxy.local:8443");
    expect(agyEnv.AGY_LLM_GATEWAY_API_KEY).toBeUndefined();

    // Rows mark CLIProxy profiles connected with proxy metadata; planAccounts excludes them from pooling.
    const claudeRows = h.accounts.rows("claude", "native@example.com", null);
    expect(claudeRows?.find((row) => row.id === claude.id)).toMatchObject({
      label: "Claude (CLIProxy)",
      state: "connected",
      proxy: { kind: "cliproxy", baseUrl: "http://127.0.0.1:8317" },
    });
    expect(h.accounts.planAccounts("claude")).toEqual([]);

    // Editing URL while omitting apiKey keeps the stored encrypted key; passing "" clears it.
    await runCauseEffect(
      h.accounts.saveCliProxyProfile({
        provider: "claude",
        accountId: claude.id,
        label: "Claude Proxy 2",
        baseUrl: "http://127.0.0.1:8318",
      }),
    );
    expect(h.keys.get(`claude:${claude.id}`)).toBe("secret-claude-proxy-key");
    expect(h.getStoppedClients()).toContainEqual({ provider: "claude", accountId: claude.id });

    await runCauseEffect(
      h.accounts.saveCliProxyProfile({
        provider: "claude",
        accountId: claude.id,
        baseUrl: "http://127.0.0.1:8318",
        apiKey: "",
      }),
    );
    expect(h.keys.get(`claude:${claude.id}`)).toBeUndefined();

    // Removing a CLIProxy profile deletes its encrypted key cleanly.
    await runCauseEffect(h.accounts.remove("codex", codex.id));
    expect(h.keys.get(`codex:${codex.id}`)).toBeUndefined();
    expect(h.store.get("codex", codex.id)).toBeNull();
  });

  it("generates isolated driver environment and Codex overrides without touching native logins", () => {
    // Codex native login has no overrides; Codex CLIProxy profile gets -c overrides + env_key.
    expect(codexVariableOverrides({})).toEqual([]);
    const codexProxyVars = cliProxyEnvironment("codex", "http://127.0.0.1:8317", "sk-codex-proxy");
    expect(codexVariableOverrides(codexProxyVars)).toEqual([
      "model_provider=openbot_environment",
      "model_providers.openbot_environment.name=OpenBot",
      "model_providers.openbot_environment.base_url=http://127.0.0.1:8317",
      "model_providers.openbot_environment.wire_api=responses",
      "model_providers.openbot_environment.env_key=OPENAI_API_KEY",
    ]);

    // Claude native login does not receive CLIProxy env; Claude CLIProxy profile overrides gateway URL/token.
    const nativeClaudeEnv = claudeAgentEnvironment({
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [],
      providerEnvironment: () => ({ ANTHROPIC_BASE_URL: "https://global.example.com" }),
    })();
    expect(nativeClaudeEnv.ANTHROPIC_BASE_URL).toBe("https://global.example.com");

    const proxyClaudeEnv = claudeAgentEnvironment({
      apiKey: () => null,
      customProviders: () => [],
      mcpServers: () => [],
      providerEnvironment: () => ({ ANTHROPIC_BASE_URL: "https://global.example.com" }),
      accountEnvironment: {
        CLAUDE_CONFIG_DIR: "/tmp/claude-cliproxy",
        ...cliProxyEnvironment("claude", "http://127.0.0.1:8317", "tok-123"),
      },
    })();
    expect(proxyClaudeEnv.CLAUDE_CONFIG_DIR).toBe("/tmp/claude-cliproxy");
    expect(proxyClaudeEnv.ANTHROPIC_BASE_URL).toBe("http://127.0.0.1:8317");
    expect(proxyClaudeEnv.ANTHROPIC_AUTH_TOKEN).toBe("tok-123");
  });
});
