import { describe, expect, it } from "vitest";
import { AGENT_ADMIN_ROUTES } from "./agent-admin-v1";
import { AGENT_INSTALL_ROUTES } from "./agent-install-v1";
import { HOST_ADMIN_ROUTES } from "./host-admin-v1";
import { optionalRouteCodec } from "./optional-routes";
import { PROVIDERS_ADMIN_ROUTES } from "./providers-v1";
import { SHARED_TABLES_ROUTES } from "./shared-tables-v1";
import { SKILLS_ADMIN_ROUTES } from "./skills-admin-v1";

function codec(path: string) {
  const found = optionalRouteCodec(path);
  if (!found) throw new Error(`No codec for ${path}.`);
  return found;
}

describe("optional admin routes", () => {
  it("matches only listed paths, with or without a query", () => {
    expect(optionalRouteCodec(`${AGENT_ADMIN_ROUTES.settings}?x=1`)).toBeDefined();
    expect(optionalRouteCodec("/v1/admin/agents")).toBeUndefined();
    expect(optionalRouteCodec("/v1/storage/usage")).toBeUndefined();
  });

  it("errors keep the message and an optional code", () => {
    const { response } = codec(AGENT_ADMIN_ROUTES.settings);
    expect(response(403, { error: "Administrator access is required." })).toEqual({
      error: "Administrator access is required.",
    });
    expect(response(400, { error: "No.", code: "protocol_error", extra: 1 })).toEqual({
      error: "No.",
      code: "protocol_error",
    });
    expect(() => response(500, {})).toThrow();
  });
});

describe("agent-admin-v1", () => {
  const settings = { access: "workspace", autoApprove: true, autoApproveLocked: false };

  it("round-trips requests and drops an absent optional field", () => {
    expect(codec(AGENT_ADMIN_ROUTES.settings).request({ agentId: "chief" })).toEqual({ agentId: "chief" });
    expect(codec(AGENT_ADMIN_ROUTES.update).request({ agentId: "chief", autoApprove: false })).toEqual({
      agentId: "chief",
      autoApprove: false,
    });
    expect(codec(AGENT_ADMIN_ROUTES.update).response(200, { ...settings, secret: "x" })).toEqual(settings);
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(AGENT_ADMIN_ROUTES.settings).request({ agentId: "" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).request({ agentId: "chief", access: "root" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).response(200, { ...settings, access: "root" })).toThrow();
    expect(() => codec(AGENT_ADMIN_ROUTES.update).response(200, { access: "full" })).toThrow();
  });
});

describe("skills-admin-v1 and shared-tables-v1", () => {
  const skill = {
    skillId: "deploy",
    slug: "deploy",
    name: "Deploy",
    installedVersion: 1,
    availableVersion: 2,
    state: "update-available",
  };

  it("carries only ids to the host and drops fields the contract does not name", () => {
    expect(codec(SKILLS_ADMIN_ROUTES.install).request({ agentId: "chief", skillId: "deploy", bundle: "x" })).toEqual({
      agentId: "chief",
      skillId: "deploy",
    });
    expect(codec(SKILLS_ADMIN_ROUTES.list).response(200, [{ ...skill, path: "/Users/host" }])).toEqual([skill]);
    expect(
      codec(SHARED_TABLES_ROUTES.list).response(200, [{ name: "leads", ownerAgentId: null, rowCount: null }]),
    ).toEqual([{ name: "leads", ownerAgentId: null, rowCount: null }]);
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(SKILLS_ADMIN_ROUTES.setEnabled).request({ agentId: "chief", skillId: "deploy" })).toThrow();
    expect(() => codec(SKILLS_ADMIN_ROUTES.list).response(200, [{ ...skill, state: "broken" }])).toThrow();
    expect(() => codec(SHARED_TABLES_ROUTES.delete).request({})).toThrow();
  });
});

describe("agent-install-v1", () => {
  const listing = { listingId: "researcher", timezone: "Europe/Warsaw", receiptId: "receipt-1" };

  it("carries only ids to the host and only the new agent's id and name back", () => {
    // An id to update is not part of the contract, so an old client cannot make a host overwrite an agent.
    expect(codec(AGENT_INSTALL_ROUTES.marketplace).request({ ...listing, agentId: "chief" })).toEqual(listing);
    expect(
      codec(AGENT_INSTALL_ROUTES.template).response(200, { agentId: "writer", name: "Writer", workspacePath: "/x" }),
    ).toEqual({ agentId: "writer", name: "Writer" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(AGENT_INSTALL_ROUTES.marketplace).request({ ...listing, receiptId: "" })).toThrow();
    expect(() => codec(AGENT_INSTALL_ROUTES.template).request({ templateId: "writer", timezone: "UTC" })).toThrow();
    expect(() => codec(AGENT_INSTALL_ROUTES.template).response(200, { name: "Writer" })).toThrow();
  });
});

describe("providers-v1", () => {
  const ready = { phase: "ready", progress: 100, message: null, version: "1.0.0" };
  const snapshot = {
    revision: 1,
    providers: { codex: ready, claude: ready, grok: ready, opencode: ready },
    toolRuntimes: { bun: ready },
  };

  it("carries a key towards the host and only a status or a flag back", () => {
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "codex", key: "sk-1" })).toEqual({
      provider: "codex",
      key: "sk-1",
    });
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).response(200, { key: "sk-1" })).toEqual({});
    expect(codec(PROVIDERS_ADMIN_ROUTES.apiKeyState).response(200, { status: "saved", key: "sk-1" })).toEqual({
      status: "saved",
    });
    const endpoint = { id: "studio", name: "Studio", baseUrl: "http://127.0.0.1/v1", hasApiKey: true, models: [] };
    expect(codec(PROVIDERS_ADMIN_ROUTES.customList).response(200, [{ ...endpoint, apiKey: "k", headers: [] }])).toEqual(
      [endpoint],
    );
    expect(codec(PROVIDERS_ADMIN_ROUTES.runtimesStatus).response(200, snapshot)).toEqual(snapshot);
    expect(
      codec(PROVIDERS_ADMIN_ROUTES.codeLoginStart).response(200, { kind: "connected", userCode: undefined }),
    ).toEqual({ kind: "connected" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "cursor", key: "sk-1" })).toThrow();
    expect(() =>
      codec(PROVIDERS_ADMIN_ROUTES.apiKeySet).request({ provider: "codex", key: "k".repeat(513) }),
    ).toThrow();
    expect(() =>
      codec(PROVIDERS_ADMIN_ROUTES.runtimesStatus).response(200, {
        ...snapshot,
        providers: { ...snapshot.providers, codex: { ...ready, progress: 0.5 } },
      }),
    ).toThrow();
    expect(() => codec(PROVIDERS_ADMIN_ROUTES.customList).response(200, [{ id: "studio" }])).toThrow();
  });
});

describe("host-admin-v1", () => {
  const logo = { mimeType: "image/png", data: "iVBORw0KGgo=" };

  it("keeps an absent field absent, carries a null logo, and sends nothing back", () => {
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "Studio" })).toEqual({ serverName: "Studio" });
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ logo: null })).toEqual({ logo: null });
    expect(codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "Studio", logo })).toEqual({
      serverName: "Studio",
      logo,
    });
    expect(codec(HOST_ADMIN_ROUTES.identity).response(200, { serverName: "Studio" })).toEqual({});
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ serverName: "s".repeat(33) })).toThrow();
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ logo: { ...logo, mimeType: "image/gif" } })).toThrow();
    expect(() => codec(HOST_ADMIN_ROUTES.identity).request({ logo: { ...logo, data: "A".repeat(699_053) } })).toThrow();
  });
});
