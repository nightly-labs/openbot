// @vitest-environment node

// Who may manage the host from a joined server. Every admin route answers an owner or admin, never
// a member, and only on a connection that negotiated the route's capability.

import type {
  AgentAccess,
  AgentStatus,
  AgentSummary,
  ApprovalAutomationPreference,
  CustomProviderSummary,
  InstalledSkill,
  ProviderRuntimeSnapshot,
  ProviderRuntimeStatus,
  SaveCustomProviderInput,
  SharedTable,
  UpdateHostIdentityInput,
} from "@openbot/contracts/ipc";
import { createOpenBotLogger, registerSecretValue } from "@openbot/logging";
import { afterEach, describe, expect, it } from "vitest";
import { createAgentAdminSettings } from "./agent-admin-settings";
import { createTeamApiFixture, stopTeamApiFixtures, type TeamApiOptions } from "./team-api-server-test-harness";

afterEach(stopTeamApiFixtures);

const CHIEF: AgentSummary = {
  id: "chief",
  provider: "codex",
  name: "Chief",
  title: "Chief of staff",
  description: "",
  notifications: true,
  model: "gpt-5.6-luna",
  reasoningEffort: "medium",
  avatarSeed: "chief",
  avatarHue: null,
  avatarUrl: null,
  threadId: "thread-chief",
  workspacePath: "/private/workspace",
  preview: "",
  updatedAt: null,
};

async function signedIn(name: string, options: Partial<TeamApiOptions>) {
  const fixture = await createTeamApiFixture(name, { configure: true });
  const { base } = await fixture.start(options);
  const admin = {
    Authorization: `Bearer ${await fixture.signIn()}`,
    "OpenBot-Protocol-Version": "3",
    "OpenBot-Capabilities":
      "agent-admin-v1, skills-admin-v1, shared-tables-v1, agent-install-v1, agent-update-v1, providers-v1, host-admin-v1",
    "Content-Type": "application/json",
  };
  const invite = await fixture.store.createInvite("member");
  const member = await fixture.store.acceptInvite(invite.token, "member", "member password");
  const asMember = { ...admin, Authorization: `Bearer ${member.sessionToken}` };
  const post = (path: string, body: unknown, headers: Record<string, string> = admin) =>
    fetch(`${base}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  return { base, admin, asMember, post };
}

describe("Team API agent-admin-v1", () => {
  it("lets only an admin read and change agent access and auto-approve", async () => {
    let access: AgentAccess = "full";
    let preference: ApprovalAutomationPreference = {
      turbo: false,
      defaultAutoApprove: false,
      autoApproveOverrides: {},
    };
    const agent = (): AgentSummary => ({ ...CHIEF, access });
    const settings = createAgentAdminSettings({
      agents: {
        listAgents: () => [agent()],
        updateAgent: async (input) => {
          if (input.access) access = input.access;
          return agent();
        },
      },
      approvalAutomation: {
        current: () => preference,
        set: async (input) => {
          if (input.agentId && input.autoApprove !== undefined)
            preference = {
              ...preference,
              autoApproveOverrides: { ...preference.autoApproveOverrides, [input.agentId]: input.autoApprove },
            };
          return preference;
        },
      },
    });
    const { base, admin, asMember, post } = await signedIn("agent-admin", { admin: { agents: settings } });

    expect(
      (await post("/v1/admin/agents/settings", { agentId: "chief" }, { ...admin, "OpenBot-Capabilities": "" })).status,
    ).toBe(400);
    expect((await post("/v1/admin/agents/settings", { agentId: "chief" }, asMember)).status).toBe(403);
    expect(
      (await post("/v1/admin/agents/settings/update", { agentId: "chief", access: "workspace" }, asMember)).status,
    ).toBe(403);
    expect(access).toBe("full");

    const read = await post("/v1/admin/agents/settings", { agentId: "chief" });
    expect(await read.json()).toEqual({ access: "full", autoApprove: false, autoApproveLocked: false });

    const updated = await post("/v1/admin/agents/settings/update", {
      agentId: "chief",
      access: "workspace",
      autoApprove: true,
    });
    expect(await updated.json()).toEqual({ access: "workspace", autoApprove: true, autoApproveLocked: false });
    expect(access).toBe("workspace");
    expect(preference.autoApproveOverrides).toEqual({ chief: true });

    // The codec refuses an unknown access mode before the host sees it, and an update must change something.
    expect((await post("/v1/admin/agents/settings/update", { agentId: "chief", access: "root" })).status).toBe(400);
    expect((await post("/v1/admin/agents/settings/update", { agentId: "chief" })).status).toBe(400);
    expect((await post("/v1/admin/agents/settings", { agentId: "missing" })).status).toBe(404);

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("agent-admin-v1");
  });

  it("does not advertise agent-admin-v1 without the service", async () => {
    const { base } = await signedIn("agent-admin-absent", {});
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).not.toContain("agent-admin-v1");
  });
});

describe("Team API skills-admin-v1", () => {
  it("lets only an admin list, install, disable and remove a skill by id", async () => {
    const installed = new Map<string, InstalledSkill>();
    const skill = (skillId: string, enabled = true): InstalledSkill => ({
      skillId,
      slug: skillId,
      name: skillId,
      installedVersion: 2,
      availableVersion: 2,
      state: "installed",
      enabled,
    });
    const skills = {
      listInstalled: async () => [...installed.values()],
      install: async (input: { skillId: string }) => {
        if (input.skillId === "paid") throw new Error("Sign in to the marketplace on the host.");
        installed.set(input.skillId, skill(input.skillId));
        return skill(input.skillId);
      },
      uninstall: async (input: { skillId: string }) => {
        installed.delete(input.skillId);
      },
      setEnabled: async (input: { skillId: string; enabled: boolean }) => {
        installed.set(input.skillId, skill(input.skillId, input.enabled));
        return skill(input.skillId, input.enabled);
      },
    };
    const { base, admin, asMember, post } = await signedIn("skills-admin", { admin: { skills } });

    expect(
      (await post("/v1/admin/skills/list", { agentId: "chief" }, { ...admin, "OpenBot-Capabilities": "" })).status,
    ).toBe(400);
    expect((await post("/v1/admin/skills/install", { agentId: "chief", skillId: "deploy" }, asMember)).status).toBe(
      403,
    );
    expect(installed.size).toBe(0);

    expect(await (await post("/v1/admin/skills/install", { agentId: "chief", skillId: "deploy" })).json()).toEqual(
      skill("deploy"),
    );
    const disabled = await post("/v1/admin/skills/set-enabled", {
      agentId: "chief",
      skillId: "deploy",
      enabled: false,
    });
    expect(await disabled.json()).toEqual(skill("deploy", false));
    expect(await (await post("/v1/admin/skills/list", { agentId: "chief" })).json()).toEqual([skill("deploy", false)]);

    // The host's reason reaches the admin, who cannot read the host log.
    const refused = await post("/v1/admin/skills/install", { agentId: "chief", skillId: "paid" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Sign in to the marketplace on the host." });

    expect((await post("/v1/admin/skills/uninstall", { agentId: "chief", skillId: "deploy" }, asMember)).status).toBe(
      403,
    );
    expect(await (await post("/v1/admin/skills/uninstall", { agentId: "chief", skillId: "deploy" })).json()).toEqual(
      {},
    );
    expect(installed.size).toBe(0);

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("skills-admin-v1");
    expect(compatibility.capabilities).not.toContain("shared-tables-v1");
  });
});

describe("Team API shared-tables-v1", () => {
  it("lets only an admin list and delete shared tables", async () => {
    let tables: SharedTable[] = [{ name: "leads", ownerAgentId: "chief", rowCount: 12 }];
    const sharedTables = {
      listTables: async () => tables,
      deleteTable: async ({ name }: { name: string }) => {
        tables = tables.filter((table) => table.name !== name);
      },
    };
    const { admin, asMember, post } = await signedIn("shared-tables", { admin: { sharedTables } });

    expect((await post("/v1/admin/shared-tables/list", {}, { ...admin, "OpenBot-Capabilities": "" })).status).toBe(400);
    expect((await post("/v1/admin/shared-tables/list", {}, asMember)).status).toBe(403);
    expect((await post("/v1/admin/shared-tables/delete", { name: "leads" }, asMember)).status).toBe(403);
    expect(tables).toHaveLength(1);

    expect(await (await post("/v1/admin/shared-tables/list", {})).json()).toEqual(tables);
    expect(await (await post("/v1/admin/shared-tables/delete", { name: "leads" })).json()).toEqual({});
    expect(tables).toEqual([]);
  });
});

describe("Team API agent-install-v1", () => {
  it("lets only an admin add an agent from a listing or a template, by id", async () => {
    const added: string[] = [];
    const marketplaceAgents = {
      install: async (input: { listingId: string; agentId?: string }) => {
        if (input.listingId === "withdrawn") throw new Error("This agent is no longer in the marketplace.");
        // The route adds a new agent only; an id to update must never reach the service.
        expect(input.agentId).toBeUndefined();
        added.push(input.listingId);
        return { agent: { ...CHIEF, id: `from-${input.listingId}`, name: "Researcher" } };
      },
    };
    const agentTemplates = {
      install: async (input: { templateId: string }) => {
        added.push(input.templateId);
        return { agent: { ...CHIEF, id: `from-${input.templateId}`, name: "Writer" } };
      },
    };
    const { base, admin, asMember, post } = await signedIn("agent-install", {
      admin: { marketplaceAgents, agentTemplates },
    });
    const listing = { listingId: "researcher", timezone: "Europe/Warsaw", receiptId: "receipt-1" };
    const template = { templateId: "writer", timezone: "Europe/Warsaw", expectedUpdatedAt: "2026-09-01T00:00:00Z" };

    expect(
      (await post("/v1/admin/agents/install-marketplace", listing, { ...admin, "OpenBot-Capabilities": "" })).status,
    ).toBe(400);
    expect((await post("/v1/admin/agents/install-marketplace", listing, asMember)).status).toBe(403);
    expect((await post("/v1/admin/agents/install-template", template, asMember)).status).toBe(403);
    expect(added).toEqual([]);

    const fromListing = await post("/v1/admin/agents/install-marketplace", { ...listing, agentId: "chief" });
    expect(await fromListing.json()).toEqual({ agentId: "from-researcher", name: "Researcher" });
    expect(await (await post("/v1/admin/agents/install-template", template)).json()).toEqual({
      agentId: "from-writer",
      name: "Writer",
    });
    expect(added).toEqual(["researcher", "writer"]);

    const refused = await post("/v1/admin/agents/install-marketplace", { ...listing, listingId: "withdrawn" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "This agent is no longer in the marketplace." });

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("agent-install-v1");
  });
});

describe("Team API agent-update-v1", () => {
  it("lets only an admin update an agent from its listing", async () => {
    const updated: Array<{ listingId: string; agentId?: string }> = [];
    const marketplaceAgents = {
      install: async (input: { listingId: string; agentId?: string }) => {
        if (input.agentId !== "chief")
          throw new Error("This local agent was installed from a different marketplace agent.");
        updated.push({ listingId: input.listingId, agentId: input.agentId });
        return { agent: { ...CHIEF, name: "Chief v2" } };
      },
    };
    // Update needs only the listing service, so a host without shared templates still offers it.
    const { base, admin, asMember, post } = await signedIn("agent-update", { admin: { marketplaceAgents } });
    const update = { agentId: "chief", listingId: "researcher", timezone: "Europe/Warsaw" };
    const path = "/v1/admin/agents/update-marketplace";

    expect((await post(path, update, { ...admin, "OpenBot-Capabilities": "agent-install-v1" })).status).toBe(400);
    expect((await post(path, update, asMember)).status).toBe(403);
    expect((await post(path, { listingId: "researcher", timezone: "UTC" })).status).toBe(400);
    expect(updated).toEqual([]);

    expect(await (await post(path, update)).json()).toEqual({ agentId: "chief", name: "Chief v2" });
    expect(updated).toEqual([{ listingId: "researcher", agentId: "chief" }]);

    const refused = await post(path, { ...update, agentId: "writer" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({
      error: "This local agent was installed from a different marketplace agent.",
    });

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("agent-update-v1");
    expect(compatibility.capabilities).not.toContain("agent-install-v1");
  });
});

describe("Team API providers-v1", () => {
  it("lets only an admin change the host's providers, and never sends a key back", async () => {
    const PROVIDER_KEY = "sk-remote-provider-key-1234";
    const ENDPOINT_KEY = "endpoint-secret-5678";
    const HEADER_VALUE = "header-secret-9012";
    const lines: string[] = [];
    const keys = new Map<string, string>();
    const status: AgentStatus = {
      phase: "ready",
      cliVersion: "1.0.0",
      auth: { kind: "unknown" },
      capabilities: { chat: "ready", browser: "ready", computerUse: "ready" },
      message: null,
      fullAccess: true,
    };
    const service = {
      startProviderCodeLogin: async () => ({
        kind: "code" as const,
        userCode: "ABCD-1234",
        verificationUrl: "https://auth.openai.com/codex/device",
        expiresAt: 1_790_000_000_000,
      }),
      cancelProviderCodeLogin: async () => status,
      changeProviderCredential: async (provider: string, change: () => Promise<void>) => {
        // A provider process can quote the key it failed with.
        if (provider === "grok") throw new Error(`Grok could not start with ${PROVIDER_KEY}.`);
        await change();
        return status;
      },
    };
    const credentials = {
      status: (provider: string) => (keys.has(provider) ? ("saved" as const) : ("missing" as const)),
      set: async (provider: string, key: string) => {
        // As the real store does, so every later log line and error can mask the key.
        registerSecretValue(key);
        keys.set(provider, key);
      },
      clear: async (provider: string) => {
        keys.delete(provider);
      },
    };
    const idle: ProviderRuntimeStatus = { phase: "ready", progress: 100, message: null, version: "1.0.0" };
    const failed: ProviderRuntimeStatus = {
      phase: "download-error",
      progress: null,
      message: "x".repeat(5000),
      version: null,
    };
    const snapshot: ProviderRuntimeSnapshot = {
      revision: 3,
      providers: { codex: idle, claude: failed, grok: idle, opencode: idle, antigravity: idle },
      toolRuntimes: { bun: idle },
    };
    const runtimes = {
      getStatus: () => snapshot,
      download: async () => snapshot,
      cancel: async () => snapshot,
      checkForUpdates: async () => snapshot,
    };
    let endpoints: CustomProviderSummary[] = [];
    const saved: SaveCustomProviderInput[] = [];
    const customProviders = {
      list: () => endpoints,
      save: async (input: SaveCustomProviderInput) => {
        saved.push(input);
        endpoints = [{ id: input.id, name: input.name, baseUrl: input.baseUrl, hasApiKey: true, models: input.models }];
        return { providers: endpoints, restart: "restarted" as const };
      },
      remove: async () => {
        endpoints = [];
        return { providers: endpoints, restart: "restarted" as const };
      },
    };
    const { base, admin, asMember, post } = await signedIn("providers", {
      admin: { providers: { service, credentials, runtimes, customProviders } },
      logger: createOpenBotLogger("test", (line) => lines.push(line)),
    });
    const bodies: string[] = [];
    const send = async (path: string, body: unknown, headers = admin) => {
      const response = await post(path, body, headers);
      bodies.push(await response.clone().text());
      return response;
    };
    const setKey = { provider: "codex", key: `  ${PROVIDER_KEY}  ` };

    expect(
      (await send("/v1/admin/providers/api-key/set", setKey, { ...admin, "OpenBot-Capabilities": "" })).status,
    ).toBe(400);
    expect((await send("/v1/admin/providers/api-key/set", setKey, asMember)).status).toBe(403);
    expect((await send("/v1/admin/providers/runtimes/status", {}, asMember)).status).toBe(403);
    expect(keys.size).toBe(0);

    expect(await (await send("/v1/admin/providers/api-key/set", setKey)).json()).toEqual({});
    expect(keys.get("codex")).toBe(PROVIDER_KEY);
    expect(await (await send("/v1/admin/providers/api-key/state", { provider: "codex" })).json()).toEqual({
      status: "saved",
    });
    const busy = await send("/v1/admin/providers/api-key/set", { provider: "grok", key: PROVIDER_KEY });
    expect(busy.status).toBe(409);
    expect(await (await send("/v1/admin/providers/api-key/clear", { provider: "codex" })).json()).toEqual({});
    expect(keys.size).toBe(0);

    expect(await (await send("/v1/admin/providers/code-login/start", { provider: "codex" })).json()).toEqual({
      kind: "code",
      userCode: "ABCD-1234",
      verificationUrl: "https://auth.openai.com/codex/device",
      expiresAt: 1_790_000_000_000,
    });
    const download = await (await send("/v1/admin/providers/runtimes/download", { provider: "claude" })).json();
    // A long download error is cut to the wire bound, so the client does not refuse the snapshot.
    expect(download.providers.claude.message).toHaveLength(1024);
    expect((await send("/v1/admin/providers/runtimes/download", { provider: "cursor" })).status).toBe(400);
    // Gemini stays on the host: providers-v1 has no entry for it, and a peer cannot name it.
    expect(Object.keys(download.providers)).toEqual(["codex", "claude", "grok", "opencode"]);
    for (const path of ["/v1/admin/providers/runtimes/download", "/v1/admin/providers/api-key/state"]) {
      expect((await send(path, { provider: "antigravity" })).status).toBe(400);
    }
    expect((await send("/v1/admin/providers/api-key/set", { provider: "antigravity", key: PROVIDER_KEY })).status).toBe(
      400,
    );
    expect(keys.size).toBe(0);

    const endpoint = {
      id: "studio",
      name: "Studio",
      baseUrl: "http://127.0.0.1:1234/v1",
      apiKey: ENDPOINT_KEY,
      models: [{ id: "qwen", name: "Qwen" }],
      headers: [{ name: "X-Token", value: HEADER_VALUE }],
    };
    expect(await (await send("/v1/admin/providers/custom/save", endpoint)).json()).toEqual({
      providers: [
        { id: "studio", name: "Studio", baseUrl: endpoint.baseUrl, hasApiKey: true, models: endpoint.models },
      ],
      restart: "restarted",
    });
    expect(saved).toEqual([endpoint]);
    expect(await (await send("/v1/admin/providers/custom/list", {})).json()).toHaveLength(1);
    expect(await (await send("/v1/admin/providers/custom/delete", { id: "studio" })).json()).toEqual({
      providers: [],
      restart: "restarted",
    });

    for (const secret of [PROVIDER_KEY, ENDPOINT_KEY, HEADER_VALUE]) {
      expect(bodies.some((body) => body.includes(secret))).toBe(false);
      expect(lines.some((line) => line.includes(secret))).toBe(false);
    }
    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("providers-v1");
  });
});

describe("Team API host-admin-v1", () => {
  it("lets only an admin change the server name and logo, and checks the image on the host", async () => {
    const changes: UpdateHostIdentityInput[] = [];
    const identity = {
      updateIdentity: async (input: UpdateHostIdentityInput) => {
        if (input.serverName === "Signed out") throw new Error("Sign in on the host first.");
        changes.push(input);
      },
    };
    const { base, admin, asMember, post } = await signedIn("host-admin", { admin: { identity } });
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);
    const logo = { mimeType: "image/png", data: Buffer.from(png).toString("base64") };

    expect(
      (await post("/v1/admin/host/identity", { serverName: "Studio" }, { ...admin, "OpenBot-Capabilities": "" }))
        .status,
    ).toBe(400);
    expect((await post("/v1/admin/host/identity", { serverName: "Studio" }, asMember)).status).toBe(403);
    // A PNG type over bytes that are not one is refused before the host sees it.
    const notPng = { mimeType: "image/png", data: Buffer.from("not an image").toString("base64") };
    expect((await post("/v1/admin/host/identity", { logo: notPng })).status).toBe(400);
    expect((await post("/v1/admin/host/identity", {})).status).toBe(400);
    expect(changes).toEqual([]);

    expect(await (await post("/v1/admin/host/identity", { serverName: "Studio", logo })).json()).toEqual({});
    expect(await (await post("/v1/admin/host/identity", { logo: null })).json()).toEqual({});
    expect(changes).toEqual([{ serverName: "Studio", logo: { mimeType: "image/png", bytes: png } }, { logo: null }]);

    const refused = await post("/v1/admin/host/identity", { serverName: "Signed out" });
    expect(refused.status).toBe(409);
    expect(await refused.json()).toEqual({ error: "Sign in on the host first." });

    const compatibility = await (await fetch(`${base}/v1/compatibility`)).json();
    expect(compatibility.capabilities).toContain("host-admin-v1");
  });
});
