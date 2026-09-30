import { describe, expect, it } from "vitest";
import { AGENT_ADMIN_ROUTES } from "./agent-admin-v1";
import { AGENT_IMPORT_ROUTES } from "./agent-import-v1";
import { AGENT_INSTALL_ROUTES } from "./agent-install-v1";
import { AGENT_PUBLISH_ROUTES } from "./agent-publish-v1";
import { AGENT_UPDATE_ROUTES } from "./agent-update-v1";
import { CONTEXT_RESET_ROUTES } from "./context-reset-v1";
import { HOST_ADMIN_ROUTES } from "./host-admin-v1";
import { HOST_UPDATE_ROUTES, hostRestartEvent } from "./host-update-v1";
import { LIVE_ACTIVITY_PUSH_ROUTES } from "./live-activity-push-v1";
import { optionalRouteCodec } from "./optional-routes";
import { PROVIDERS_ADMIN_ROUTES } from "./providers-v1";
import { PROVIDERS_SIGN_IN_V3_ROUTES } from "./providers-v3";
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

describe("agent-update-v1", () => {
  const update = { agentId: "chief", listingId: "researcher", timezone: "Europe/Warsaw" };

  it("carries only ids to the host and only the agent's id and name back", () => {
    expect(codec(AGENT_UPDATE_ROUTES.marketplace).request({ ...update, receiptId: "receipt-1" })).toEqual(update);
    expect(
      codec(AGENT_UPDATE_ROUTES.marketplace).response(200, { agentId: "chief", name: "Chief", workspacePath: "/x" }),
    ).toEqual({ agentId: "chief", name: "Chief" });
  });

  it("rejects an update without the agent to update", () => {
    expect(() =>
      codec(AGENT_UPDATE_ROUTES.marketplace).request({ listingId: "researcher", timezone: "UTC" }),
    ).toThrow();
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

describe("providers-v3", () => {
  const routes = PROVIDERS_SIGN_IN_V3_ROUTES;

  it("carries a pasted code towards the host and never back", () => {
    expect(codec(routes.codeLoginStart).request({ provider: "claude" })).toEqual({ provider: "claude" });
    const paste = { kind: "paste", verificationUrl: "https://claude.com/cai/oauth/authorize?code=true", expiresAt: 1 };
    expect(codec(routes.codeLoginStart).response(200, { ...paste, userCode: "extra" })).toEqual(paste);
    const device = {
      kind: "code",
      userCode: "6Z9Q-HAAK",
      verificationUrl: "https://accounts.x.ai/oauth2/device",
      verificationUrlComplete: "https://accounts.x.ai/oauth2/device?user_code=6Z9Q-HAAK",
      expiresAt: 1,
    };
    expect(codec(routes.codeLoginStart).response(200, device)).toEqual(device);
    expect(codec(routes.codeLoginSubmit).request({ provider: "claude", code: "abc#state" })).toEqual({
      provider: "claude",
      code: "abc#state",
    });
    expect(codec(routes.codeLoginSubmit).response(200, { code: "abc#state" })).toEqual({});
    expect(codec(routes.codeLoginCancel).request({ provider: "grok" })).toEqual({ provider: "grok" });
  });

  it("rejects malformed payloads", () => {
    expect(() => codec(routes.codeLoginStart).request({ provider: "opencode" })).toThrow();
    expect(() => codec(routes.codeLoginStart).response(200, { kind: "paste", expiresAt: 1 })).toThrow();
    expect(() => codec(routes.codeLoginSubmit).request({ provider: "claude", code: "x".repeat(2049) })).toThrow();
    expect(() => codec(routes.codeLoginSubmit).request({ provider: "claude" })).toThrow();
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

describe("host-update-v1", () => {
  const snapshot = {
    phase: "ready",
    currentVersion: "0.24.0",
    availableVersion: "0.25.0",
    progress: 100,
    errorCode: null,
    remoteUpdates: "allowed",
    autoDownload: true,
    autoInstall: false,
    restart: { requestedBy: "Ada", mode: "when-idle", waitingFor: ["agent-turn", "other"] },
  };

  it("sends only the restart mode and answers every route with one snapshot", () => {
    expect(codec(HOST_UPDATE_ROUTES.start).request({ restart: "now", force: true })).toEqual({ restart: "now" });
    for (const route of Object.values(HOST_UPDATE_ROUTES)) {
      expect(codec(route).response(200, { ...snapshot, message: "/Users/ada/Library" })).toEqual(snapshot);
    }
    expect(
      codec(HOST_UPDATE_ROUTES.status).response(200, {
        ...snapshot,
        restart: { ...snapshot.restart, requestedBy: null },
      }),
    ).toEqual({
      ...snapshot,
      restart: { ...snapshot.restart, requestedBy: null },
    });
    expect(codec(HOST_UPDATE_ROUTES.settings).request({ autoInstall: true, allowRemoteUpdates: true })).toEqual({
      autoInstall: true,
    });
  });

  it("tells members about the restart and fails closed on a malformed restart event", () => {
    const event = { type: "host-restart", state: "waiting", version: "0.25.0" };
    expect(hostRestartEvent({ ...event, requestedBy: "Ada" })).toEqual(event);
    expect(hostRestartEvent({ type: "channels-changed", channelId: "c1", revision: 1 })).toBeNull();
    expect(() => hostRestartEvent({ ...event, state: "paused" })).toThrow();
    expect(() => hostRestartEvent({ ...event, version: "" })).toThrow();
    expect(() => hostRestartEvent({ type: "host-restart", state: "none" })).toThrow();
  });

  it("rejects malformed payloads, including a wait reason the contract does not list", () => {
    expect(() => codec(HOST_UPDATE_ROUTES.start).request({})).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.start).request({ restart: "later" })).toThrow();
    const restart = (waitingFor: string[]) => ({ ...snapshot, restart: { ...snapshot.restart, waitingFor } });
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, restart(["new-blocker"]))).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, restart(Array(17).fill("other")))).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, progress: 12.5 })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, phase: "paused" })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, remoteUpdates: "maybe" })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.status).response(200, { ...snapshot, autoInstall: undefined })).toThrow();
    expect(() => codec(HOST_UPDATE_ROUTES.settings).request({ autoInstall: "yes" })).toThrow();
  });
});

describe("context-reset-v1", () => {
  it("carries only the agent id and sends nothing back", () => {
    expect(codec(CONTEXT_RESET_ROUTES.clear).request({ agentId: "chief", threadId: "t1" })).toEqual({
      agentId: "chief",
    });
    expect(() => codec(CONTEXT_RESET_ROUTES.clear).request({})).toThrow();
    expect(codec(CONTEXT_RESET_ROUTES.clear).response(200, {})).toEqual({});
  });
});

describe("agent-publish-v1", () => {
  const publication = {
    templateId: "tpl_chief",
    shareUrl: "https://openbot.run/agents/tpl_chief",
    publishedAt: "2026-09-29T00:00:00Z",
  };
  const preview = {
    agentId: "chief",
    name: "Chief",
    title: "Chief of staff",
    description: "Plan the week.",
    avatarSeed: "chief",
    avatarHue: 30,
    avatarImage: { mimeType: "image/png", data: "iVBORw0KGgo=" },
    skills: [
      { kind: "marketplace", skillId: "s1", versionId: "v1", slug: "notes", name: "Notes", version: 2 },
      { kind: "embedded", slug: "brief", name: "Brief", markdown: "# Brief" },
    ],
    routines: [
      {
        name: "Weekly plan",
        instruction: "Plan the week.",
        active: true,
        schedule: {
          kind: "advanced",
          months: [1, 6],
          days: { kind: "days-of-week", days: [1] },
          time: { kind: "at-time", time: "09:00" },
        },
      },
    ],
    updatedAt: null,
    publication,
    skillsError: null,
  };

  it("carries the agent id and a card to the host, and the preview and link back", () => {
    expect(codec(AGENT_PUBLISH_ROUTES.preview).response(200, { ...preview, avatarUrl: "file:///a.png" })).toEqual(
      preview,
    );
    expect(codec(AGENT_PUBLISH_ROUTES.publish).request({ agentId: "chief", card: null, snapshot: {} })).toEqual({
      agentId: "chief",
      card: null,
    });
    expect(codec(AGENT_PUBLISH_ROUTES.publish).response(200, publication)).toEqual(publication);
    expect(codec(AGENT_PUBLISH_ROUTES.unpublish).response(200, {})).toEqual({});
  });

  it("rejects malformed payloads", () => {
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.publish).request({ agentId: "chief", card: "A".repeat(699_053) }),
    ).toThrow();
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.preview).response(200, { ...preview, skills: [{ kind: "folder", slug: "x" }] }),
    ).toThrow();
    expect(() =>
      codec(AGENT_PUBLISH_ROUTES.preview).response(200, {
        ...preview,
        routines: [{ ...preview.routines[0], schedule: { kind: "yearly" } }],
      }),
    ).toThrow();
  });
});

describe("agent-import-v1", () => {
  const agent = {
    key: "research",
    name: "Research",
    title: "Analyst",
    description: "You are research.",
    skillCount: 1,
    routineCount: 0,
    memoryCount: 2,
    fileCount: 3,
    fileBytes: 400,
    nameExists: false,
  };
  const preview = {
    token: "token-1",
    sourceApp: "grok-bot",
    exportedAt: null,
    agents: [agent],
    channels: [
      {
        key: "desk",
        name: "Desk",
        title: "",
        memberKeys: ["research"],
        leadKey: null,
        memoryCount: 0,
        routineCount: 0,
      },
    ],
    warnings: [],
  };

  it("sends the preview without avatars and the result with only the new agents' ids and names", () => {
    const withAvatar = { ...preview, agents: [{ ...agent, avatarUrl: "data:image/png;base64,AAAA" }] };
    expect(codec(AGENT_IMPORT_ROUTES.stage).response(200, withAvatar)).toEqual(preview);
    const result = {
      agents: [{ agentId: "a1", name: "Research", workspacePath: "/Users/host/OpenBot/a1" }],
      skipped: [],
      channels: [{ id: "c1", name: "Desk" }],
      skippedChannels: [],
      warnings: [],
    };
    expect(codec(AGENT_IMPORT_ROUTES.apply).response(200, result)).toEqual({
      ...result,
      agents: [{ agentId: "a1", name: "Research" }],
    });
    const input = { token: "token-1", keys: ["research"], channelKeys: [], timezone: "Europe/Warsaw" };
    expect(codec(AGENT_IMPORT_ROUTES.apply).request(input)).toEqual(input);
    expect(codec(AGENT_IMPORT_ROUTES.discard).request({ token: "token-1" })).toEqual({ token: "token-1" });
  });

  it("rejects malformed payloads", () => {
    expect(() =>
      codec(AGENT_IMPORT_ROUTES.stage).response(200, { ...preview, agents: [{ ...agent, key: 1 }] }),
    ).toThrow();
    expect(() => codec(AGENT_IMPORT_ROUTES.apply).request({ token: "token-1", keys: ["research"] })).toThrow();
    expect(() => codec(AGENT_IMPORT_ROUTES.discard).request({})).toThrow();
  });
});

describe("live-activity-push-v1", () => {
  const registration = {
    serverId: "server-1",
    token: "ab".repeat(32),
    environment: "production",
    secret: "A".repeat(43),
    locale: "fr",
    away: true,
    photos: [{ agentId: "chief", file: "avatar-server_2d_1-chief-3.jpg" }],
  };

  it("carries the push registration and nothing else", () => {
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.register).request({ ...registration, name: "Ada" })).toEqual(registration);
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.register).response(200, {})).toEqual({});
    expect(codec(LIVE_ACTIVITY_PUSH_ROUTES.remove).request({})).toEqual({});
  });

  it("refuses a token, secret or file name that could reach a path or a header", () => {
    const request = codec(LIVE_ACTIVITY_PUSH_ROUTES.register).request;
    expect(() => request({ ...registration, token: "../../3/device" })).toThrow();
    expect(() => request({ ...registration, secret: "short" })).toThrow();
    expect(() => request({ ...registration, photos: [{ agentId: "chief", file: "../secret.png" }] })).toThrow();
    expect(() => request({ ...registration, environment: "staging" })).toThrow();
  });
});
