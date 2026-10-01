import { createSlackWorkspaceKeyPair, openSlackWorkspaceGrant } from "@openbot/contracts/slack-workspace-grant";
import { describe, expect, it, vi } from "vitest";
import { SlackAppService } from "../src/server/slack-app";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
const other = { id: "other", email: "other@example.com", name: null, avatarUrl: null };
const redirectUri = "https://openbot.run/v2/slack/callback";
const secrets = { SLACK_CLIENT_ID: "client", SLACK_CLIENT_SECRET: "secret", SLACK_STATE_SECRET: "s".repeat(32) };

// The bot token reads and writes a whole workspace, and the workspace link decides which computer
// gets its messages. The Worker must never return the token in clear, must not act on a state it did
// not sign, and must not let another account take a workspace from its host.
describe("OpenBot Slack app install", () => {
  it("seals the bot token to the host that asked and links the workspace to that host", async () => {
    const { service, database, fetch } = setup();
    const host = await createSlackWorkspaceKeyPair();
    const nonce = "nonce-0123456789abcdef";

    await expect(
      service.authorizeUrl(other, { hostId: "host-1", hostNonce: nonce, hostPublicKey: host.publicKey, redirectUri }),
    ).rejects.toMatchObject({ code: "forbidden" });
    const state = await stateOf(service, owner, "host-1", nonce, host.publicKey);

    const [body, signature] = state.split(".");
    await expect(service.complete({ code: "code", state: `${body}x.${signature}`, redirectUri })).rejects.toThrow();
    expect(fetch).not.toHaveBeenCalled();

    const result = await service.complete({ code: "code", state, redirectUri });
    expect(JSON.stringify(result)).not.toContain("xoxb");
    expect(result.nonce).toBe(nonce);
    await expect(openSlackWorkspaceGrant(host.privateKey, nonce, result.grant)).resolves.toEqual({
      botToken: "xoxb-bot-secret",
      botUserId: "UBOT",
      appId: "A1",
      workspaceId: "T1",
      workspaceName: "Acme",
    });
    expect(database.prepare("SELECT team_id, host_id, account_id FROM slack_workspace_routes").all()).toEqual([
      { team_id: "T1", host_id: "host-1", account_id: "owner" },
    ]);

    // The same account moves the workspace to its other host.
    await service.complete({
      code: "code",
      state: await stateOf(service, owner, "host-2", nonce, host.publicKey),
      redirectUri,
    });
    expect(database.prepare("SELECT host_id FROM slack_workspace_routes").all()).toEqual([{ host_id: "host-2" }]);
    // Each link tells Signal to drop older routes, so host-1 cannot keep the workspace.
    expect(revocations(database)).toHaveLength(2);

    // Another account cannot take it.
    await expect(
      service.complete({
        code: "code",
        state: await stateOf(service, other, "host-3", nonce, host.publicKey),
        redirectUri,
      }),
    ).rejects.toMatchObject({ code: "slack_workspace_taken" });
    expect(database.prepare("SELECT host_id FROM slack_workspace_routes").all()).toEqual([{ host_id: "host-2" }]);
    expect(revocations(database)).toHaveLength(2);
  });

  it("refuses an install for a whole Enterprise organization", async () => {
    const { service, database } = setup({ is_enterprise_install: true });
    const host = await createSlackWorkspaceKeyPair();
    const state = await stateOf(service, owner, "host-1", "nonce-0123456789abcdef", host.publicKey);
    await expect(service.complete({ code: "code", state, redirectUri })).rejects.toMatchObject({
      code: "slack_enterprise_install",
    });
    expect(database.prepare("SELECT team_id FROM slack_workspace_routes").all()).toEqual([]);
  });
  it("takes a loopback return address only on a development API", async () => {
    const host = await createSlackWorkspaceKeyPair();
    const request = (returnUrl: string) => ({
      hostId: "host-1",
      hostNonce: "nonce-0123456789abcdef",
      hostPublicKey: host.publicKey,
      redirectUri,
      returnUrl,
    });
    const loopback = "http://127.0.0.1:43123/slack-workspace";
    await expect(setup().service.authorizeUrl(owner, request(loopback))).rejects.toMatchObject({
      code: "invalid_slack_request",
    });
    const development = setup({}, "https://tunnel.trycloudflare.com").service;
    expect(development.redirectUri("http://127.0.0.1:3100/v2/slack/authorize")).toBe(
      "https://tunnel.trycloudflare.com/v2/slack/callback",
    );
    await expect(
      development.authorizeUrl(owner, request("https://attacker.example/slack-workspace")),
    ).rejects.toMatchObject({ code: "invalid_slack_request" });
    const state = new URL(await development.authorizeUrl(owner, request(loopback))).searchParams.get("state") ?? "";
    await expect(development.complete({ code: "code", state, redirectUri })).resolves.toMatchObject({
      returnUrl: loopback,
    });
  });
});

function revocations(database: ReturnType<typeof migratedDatabase>) {
  return database
    .prepare("SELECT payload FROM remote_auth_events WHERE payload LIKE '%slack-route-revoked%'")
    .all()
    .map((row) => JSON.parse(String(row.payload)));
}

function setup(extra: { is_enterprise_install?: boolean } = {}, developmentOrigin?: string) {
  const database = migratedDatabase();
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1),
             ('other', 'email:other@example.com', 'other@example.com', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Mac', 1, 1), ('host-2', 'owner', 'Server', 1, 1), ('host-3', 'other', 'Other', 1, 1);
  `);
  const fetch = vi.fn(async () =>
    Response.json({
      ok: true,
      token_type: "bot",
      access_token: "xoxb-bot-secret",
      bot_user_id: "UBOT",
      app_id: "A1",
      team: { id: "T1", name: "Acme" },
      ...extra,
    }),
  );
  const bindings = {
    DB: sqliteD1(database),
    ...secrets,
    ...(developmentOrigin ? { SLACK_DEV_PUBLIC_ORIGIN: developmentOrigin } : {}),
  };
  return { service: new SlackAppService(bindings, { fetch }), database, fetch };
}

async function stateOf(
  service: SlackAppService,
  user: typeof owner,
  hostId: string,
  hostNonce: string,
  hostPublicKey: string,
): Promise<string> {
  const url = new URL(await service.authorizeUrl(user, { hostId, hostNonce, hostPublicKey, redirectUri }));
  expect(url.searchParams.get("scope")).toContain("chat:write");
  const state = url.searchParams.get("state");
  if (!state) throw new Error("The authorize URL has no state.");
  return state;
}
