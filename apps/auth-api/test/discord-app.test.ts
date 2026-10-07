import { DISCORD_BOT_PERMISSIONS } from "@openbot/contracts/discord-app";
import { createDiscordGuildKeyPair, openDiscordGuildGrant } from "@openbot/contracts/discord-guild-grant";
import { describe, expect, it, vi } from "vitest";
import { DiscordAppService } from "../src/server/discord-app";
import { runApiEffect } from "../src/server/effect-runtime";
import { migratedDatabase, sqliteD1 } from "./sqlite-d1";

const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
const other = { id: "other", email: "other@example.com", name: null, avatarUrl: null };
const redirectUri = "https://openbot.run/v2/discord/callback";
const secrets = { DISCORD_CLIENT_ID: "123456", DISCORD_CLIENT_SECRET: "secret", DISCORD_STATE_SECRET: "s".repeat(32) };

// The guild link decides which computer gets a Discord server's messages. The Worker must not act on
// a state it did not sign, must not let another account take a guild from its host, and must not keep
// or return the user token that the exchange gives.
describe("OpenBot Discord app install", () => {
  it("links the guild to the host that asked and seals the link to that host", async () => {
    const { service, database, fetch } = setup();
    const host = await createDiscordGuildKeyPair();
    const nonce = "nonce-0123456789abcdef";

    await expect(
      runApiEffect(
        service.authorizeUrl(other, { hostId: "host-1", hostNonce: nonce, hostPublicKey: host.publicKey, redirectUri }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    const state = await stateOf(service, owner, "host-1", nonce, host.publicKey);

    const [body, signature] = state.split(".");
    await expect(
      runApiEffect(service.complete({ code: "code", state: `${body}x.${signature}`, redirectUri })),
    ).rejects.toMatchObject({ code: "discord_state_invalid" });
    expect(fetch).not.toHaveBeenCalled();

    const result = await runApiEffect(service.complete({ code: "code", state, redirectUri }));
    expect(JSON.stringify(result)).not.toContain("user-token");
    expect(result.nonce).toBe(nonce);
    await expect(openDiscordGuildGrant(host.privateKey, nonce, result.grant)).resolves.toEqual({
      guildId: "111",
      guildName: "Acme",
      appId: "123456",
    });
    const otherHost = await createDiscordGuildKeyPair();
    await expect(openDiscordGuildGrant(otherHost.privateKey, nonce, result.grant)).rejects.toThrow();
    // The user token is revoked at once.
    expect(fetch).toHaveBeenCalledWith("https://discord.com/api/v10/oauth2/token/revoke", expect.anything());
    expect(database.prepare("SELECT guild_id, host_id, account_id FROM discord_guild_routes").all()).toEqual([
      { guild_id: "111", host_id: "host-1", account_id: "owner" },
    ]);

    // The same account moves the guild to its other host.
    await runApiEffect(
      service.complete({
        code: "code",
        state: await stateOf(service, owner, "host-2", nonce, host.publicKey),
        redirectUri,
      }),
    );
    expect(database.prepare("SELECT host_id FROM discord_guild_routes").all()).toEqual([{ host_id: "host-2" }]);
    // Each link tells Signal to drop older routes of the guild, so host-1 cannot keep it.
    expect(revocations(database)).toEqual([
      { type: "discord-route-revoked", guildId: "111", through: expect.any(Number) },
      { type: "discord-route-revoked", guildId: "111", through: expect.any(Number) },
    ]);

    // Another account cannot take it.
    await expect(
      runApiEffect(
        service.complete({
          code: "code",
          state: await stateOf(service, other, "host-3", nonce, host.publicKey),
          redirectUri,
        }),
      ),
    ).rejects.toMatchObject({ code: "discord_guild_taken" });
    expect(database.prepare("SELECT host_id FROM discord_guild_routes").all()).toEqual([{ host_id: "host-2" }]);
    expect(revocations(database)).toHaveLength(2);
  });

  it("links the guild when Discord does not revoke the user token", async () => {
    const { service, database } = setup({ revokeFails: true });
    const host = await createDiscordGuildKeyPair();
    const state = await stateOf(service, owner, "host-1", "nonce-0123456789abcdef", host.publicKey);
    await expect(runApiEffect(service.complete({ code: "code", state, redirectUri }))).resolves.toMatchObject({
      nonce: "nonce-0123456789abcdef",
    });
    expect(database.prepare("SELECT guild_id FROM discord_guild_routes").all()).toEqual([{ guild_id: "111" }]);
  });
});

function revocations(database: ReturnType<typeof migratedDatabase>) {
  return database
    .prepare("SELECT payload FROM remote_auth_events WHERE payload LIKE '%discord-route-revoked%'")
    .all()
    .map((row) => JSON.parse(String(row.payload)));
}

function setup(options: { revokeFails?: boolean } = {}) {
  const database = migratedDatabase();
  database.exec(`
    INSERT INTO users(id, identity_key, email, created_at, updated_at)
      VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1),
             ('other', 'email:other@example.com', 'other@example.com', 1, 1);
    INSERT INTO remote_hosts(host_id, owner_user_id, name, created_at, updated_at)
      VALUES ('host-1', 'owner', 'Mac', 1, 1), ('host-2', 'owner', 'Server', 1, 1), ('host-3', 'other', 'Other', 1, 1);
  `);
  const fetch = vi.fn(async (input: string | URL | Request) => {
    if (String(input).endsWith("/revoke")) {
      if (options.revokeFails) throw new Error("Network failure");
      return new Response(null, { status: 200 });
    }
    return Response.json({
      access_token: "user-token",
      token_type: "Bearer",
      scope: "bot",
      guild: { id: "111", name: "Acme" },
    });
  });
  return { service: new DiscordAppService({ DB: sqliteD1(database), ...secrets }, { fetch }), database, fetch };
}

async function stateOf(
  service: DiscordAppService,
  user: typeof owner,
  hostId: string,
  hostNonce: string,
  hostPublicKey: string,
): Promise<string> {
  const url = new URL(
    await runApiEffect(service.authorizeUrl(user, { hostId, hostNonce, hostPublicKey, redirectUri })),
  );
  expect(url.searchParams.get("scope")).toBe("bot");
  expect(url.searchParams.get("permissions")).toBe(DISCORD_BOT_PERMISSIONS);
  const state = url.searchParams.get("state");
  if (!state) throw new Error("The authorize URL has no state.");
  return state;
}
