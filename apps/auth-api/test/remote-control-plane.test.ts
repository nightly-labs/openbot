import { createHmac } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { Effect } from "effect";
import { decodeJwt, exportJWK, generateKeyPair, importJWK, jwtVerify } from "jose";
import { describe, expect, it, vi } from "vitest";
import { AuthService } from "../src/server/auth-service";
import { sha256 } from "../src/server/crypto";
import { D1AuthRepository } from "../src/server/d1-auth-repository";
import { runApiEffect } from "../src/server/effect-runtime";
import {
  deliverPendingRemoteAuthEvents,
  notifyAccountProfileChanged,
  RemoteControlPlane,
  RemoteTicketSigner,
  verifyRemoteServiceSignature,
} from "../src/server/remote-control-plane";
import { sqliteD1 } from "./sqlite-d1";

/** The account server reads the plan of a host for its member limit, and its Slack and Discord links. */
function applyPlanMigrations(database: DatabaseSync): void {
  for (const name of [
    "0022_billing.sql",
    "0023_hosted_servers.sql",
    "0025_slack_workspace_routes.sql",
    "0026_discord_guild_routes.sql",
    "0027_webhook_routes.sql",
  ]) {
    database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
  }
}

describe("remote control plane migration", () => {
  it("keeps each tunnel owner and does not import other members", () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE team_tunnels (
        server_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        tunnel_id TEXT,
        tunnel_name TEXT NOT NULL,
        api_hostname TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        machine_token_hash TEXT
      );
      INSERT INTO users(id) VALUES ('owner'), ('former-member');
      INSERT INTO team_tunnels(
        server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
      ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, '${"a".repeat(64)}');
    `);

    database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));

    expect(database.prepare("SELECT host_id, owner_user_id, auth_epoch FROM remote_hosts").all()).toEqual([
      { host_id: "host-1", owner_user_id: "owner", auth_epoch: 1 },
    ]);
    expect(database.prepare("SELECT membership_id, user_id, role, status FROM remote_memberships").all()).toEqual([
      { membership_id: "host-1:owner", user_id: "owner", role: "owner", status: "active" },
    ]);
    expect(database.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
    expect(database.prepare("PRAGMA integrity_check").get()).toEqual({ integrity_check: "ok" });
  });
});

describe("account profile invalidation outbox", () => {
  it.each(["unavailable", "timeout"])(
    "returns after persisting and retries a signed notification when Signal is %s",
    async (failure) => {
      const database = new DatabaseSync(":memory:");
      try {
        const migrations = new URL("../migrations/", import.meta.url);
        for (const name of readdirSync(migrations)
          .filter((name) => name.endsWith(".sql"))
          .sort()) {
          database.exec(readFileSync(new URL(name, migrations), "utf8"));
        }
        const bindings = {
          DB: sqliteD1(database),
          REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
          REMOTE_AUTH_WEBHOOK_SECRET: "s".repeat(32),
        };
        const payload = JSON.stringify({ type: "account-profile-changed", userId: "owner" });
        let deliveredBody: RequestInit["body"];
        let deliveredHeaders = new Headers();
        let finishDelivery: ((response: Response) => void) | undefined;
        let background: Promise<void> | undefined;
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        vi.spyOn(AbortSignal, "timeout").mockImplementation((milliseconds) => {
          const controller = new AbortController();
          setTimeout(() => controller.abort(new DOMException("Timed out", "TimeoutError")), milliseconds);
          return controller.signal;
        });
        // workerd's global fetch rejects being invoked as a dependency object's method.
        vi.stubGlobal(
          "fetch",
          async function (this: typeof globalThis | undefined, _url: string | URL | Request, init?: RequestInit) {
            if (this !== undefined && this !== globalThis) throw new TypeError("Illegal invocation");
            deliveredBody = init?.body;
            deliveredHeaders = new Headers(init?.headers);
            return new Promise<Response>((resolve, reject) => {
              finishDelivery = resolve;
              init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
            });
          },
        );
        await runApiEffect(
          notifyAccountProfileChanged(bindings, "owner", (delivery) => {
            background = runApiEffect(delivery);
          }),
        );
        expect(database.prepare("SELECT payload, attempts FROM remote_auth_events").all()).toEqual([
          { payload, attempts: 0 },
        ]);
        await vi.waitFor(() => expect(deliveredBody).toBe(payload));
        expect(deliveredHeaders.get("OpenBot-Signature")).toBe(
          createHmac("sha256", bindings.REMOTE_AUTH_WEBHOOK_SECRET)
            .update(`${deliveredHeaders.get("OpenBot-Timestamp")}.${payload}`)
            .digest("base64url"),
        );
        if (failure === "unavailable") finishDelivery?.(new Response(null, { status: 503 }));
        else await vi.advanceTimersByTimeAsync(5_000);
        await background;
        expect(database.prepare("SELECT payload, attempts FROM remote_auth_events").all()).toEqual([
          { payload, attempts: 1 },
        ]);
        await runApiEffect(
          deliverPendingRemoteAuthEvents(bindings, Date.now() + 3_600_000, async (_url, init) => {
            expect(init?.body).toBe(payload);
            return new Response(null, { status: 204 });
          }),
        );
        expect(database.prepare("SELECT payload FROM remote_auth_events").all()).toEqual([]);
      } finally {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
        vi.useRealTimers();
        database.close();
      }
    },
  );
});

describe("RemoteTicketSigner", () => {
  it("issues a short ES256 ticket with the fixed protocol version", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
    const signer = new RemoteTicketSigner({
      privateJwk: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      publicJwks: JSON.stringify({ keys: [publicJwk] }),
      keyId: "test-key",
    });

    const result = await runApiEffect(
      signer.issue({
        sessionId: "session-1",
        hostId: "host-1",
        userId: "user-1",
        membershipId: "member-1",
        role: "member",
        authEpoch: 3,
        clientPublicKey: "client-public-key",
        sessionExpiresAt: 1_900_086_400_000,
        now: 1_900_000_000_000,
      }),
    );
    const key = await importJWK(publicJwk, "ES256");
    const verified = await jwtVerify(result.ticket, key, {
      audience: "openbot-remote",
      algorithms: ["ES256"],
      currentDate: new Date(1_900_000_001_000),
    });
    expect(verified.protectedHeader.kid).toBe("test-key");
    expect(verified.payload).toMatchObject({
      sessionId: "session-1",
      hostId: "host-1",
      membershipId: "member-1",
      role: "member",
      authEpoch: 3,
      protocolMinimum: 2,
      protocolMaximum: 2,
      sessionExpiresAt: 1_900_086_400,
      clientPublicKey: "client-public-key",
    });
    expect(result.expiresAt).toBe(1_900_000_180_000);
  });

  it("does not issue a ticket beyond the logical session expiration", async () => {
    const pair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
    const signer = new RemoteTicketSigner({
      privateJwk: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      publicJwks: JSON.stringify({ keys: [publicJwk] }),
      keyId: "test-key",
    });
    const result = await runApiEffect(
      signer.issue({
        sessionId: "session-1",
        hostId: "host-1",
        userId: "user-1",
        membershipId: "member-1",
        role: "member",
        authEpoch: 1,
        sessionExpiresAt: 1_900_000_030_000,
        now: 1_900_000_000_000,
      }),
    );
    expect(result.expiresAt).toBe(1_900_000_030_000);
  });
});

describe("Remote service authentication", () => {
  it("accepts only a current request with a valid HMAC", async () => {
    const secret = "s".repeat(32);
    const body = '{"sessionId":"session-1"}';
    const timestamp = "1900000000";
    const signature = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("base64url");
    await expect(
      runApiEffect(verifyRemoteServiceSignature(secret, body, timestamp, signature, 1_900_000_000_000)),
    ).resolves.toBe(true);
    await expect(
      runApiEffect(verifyRemoteServiceSignature(secret, body, timestamp, "invalid", 1_900_000_000_000)),
    ).resolves.toBe(false);
    await expect(
      runApiEffect(verifyRemoteServiceSignature(secret, body, timestamp, signature, 1_900_001_000_000)),
    ).resolves.toBe(false);
  });
});

describe("RemoteControlPlane", () => {
  it("lists only public account-session metadata and revokes permanent desktops with live remote access", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const migrations = new URL("../migrations/", import.meta.url);
      for (const name of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        database.exec(readFileSync(new URL(name, migrations), "utf8"));
      }
      database.exec(`
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1), ('stranger', 'email:stranger@example.com', 'stranger@example.com', 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, auth_epoch, created_at, updated_at) VALUES ('host', 'owner', 'Desktop', 'public-key', 1, 1, 1);
        INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('owner-member', 'host', 'owner', 'owner', 'active', 1, 1);
        INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at) VALUES ('live-desktop', 'host', 'owner', 'owner-member', 1, 8640000000000000);
      `);
      const currentId = "00000000-0000-4000-8000-000000000001";
      const targetId = "00000000-0000-4000-8000-000000000002";
      const strangerId = "00000000-0000-4000-8000-000000000003";
      const insert = database.prepare(
        "INSERT INTO auth_sessions(id, token_hash, user_id, created_at, last_used_at, expires_at) VALUES (?, ?, ?, 1, 1, 8640000000000000)",
      );
      insert.run(currentId, await runApiEffect(sha256("current-token")), "owner");
      insert.run(targetId, await runApiEffect(sha256("target-token")), "owner");
      insert.run(strangerId, await runApiEffect(sha256("stranger-token")), "stranger");
      const db = sqliteD1(database);
      const repository = new D1AuthRepository(db);
      const delivered: unknown[] = [];
      const now = 10_000_000_000_000;
      const service = new AuthService({
        repository,
        now: () => now,
        delivery: { send: () => Effect.void },
        flushSessionRevocations: () =>
          deliverPendingRemoteAuthEvents(
            {
              DB: db,
              REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
              REMOTE_AUTH_WEBHOOK_SECRET: "s".repeat(32),
            },
            now,
            async (_url, init) => {
              delivered.push(JSON.parse(String(init?.body)));
              return new Response(null, { status: 204 });
            },
          ),
      });
      expect(await runApiEffect(service.listAccountSessions("current-token"))).toEqual([
        { sessionId: currentId, name: "Desktop", kind: "desktop", current: true, connectedAt: 1, lastActiveAt: now },
        { sessionId: targetId, name: "Desktop", kind: "desktop", current: false, connectedAt: 1, lastActiveAt: 1 },
      ]);
      await expect(runApiEffect(service.listAccountSessions("invalid-token"))).rejects.toMatchObject({ status: 401 });
      await expect(runApiEffect(service.revokeAccountSession("invalid-token", targetId))).rejects.toMatchObject({
        status: 401,
      });
      await runApiEffect(service.revokeAccountSession("stranger-token", targetId));
      expect(await runApiEffect(service.authenticate("target-token"))).toMatchObject({ id: "owner" });
      expect(delivered).toEqual([]);
      await runApiEffect(service.revokeAccountSession("current-token", targetId));
      expect(await runApiEffect(service.authenticate("target-token"))).toBeNull();
      expect(
        (await runApiEffect(service.listAccountSessions("current-token"))).map((session) => session.sessionId),
      ).toEqual([currentId]);
      expect(await runApiEffect(service.authenticate("stranger-token"))).toMatchObject({ id: "stranger" });
      expect(database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = 'live-desktop'").get()).toEqual({
        ended_at: now,
      });
      expect(delivered).toEqual([{ type: "remote-session-ended", hostId: "host", sessionId: "live-desktop" }]);
    } finally {
      database.close();
    }
  });
  it("binds mobile tickets and delivers device revocation for an already connected phone", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const migrations = new URL("../migrations/", import.meta.url);
      for (const name of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        database.exec(readFileSync(new URL(name, migrations), "utf8"));
      }
      const db = sqliteD1(database);
      const repository = new D1AuthRepository(db);
      database.exec(`
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, auth_epoch, created_at, updated_at) VALUES ('host-a', 'owner', 'Desktop A', 'public-key-a', 1, 1, 1);
        INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('owner-member', 'host-a', 'owner', 'owner', 'active', 1, 1);
      `);
      const host = { hostId: "host-a", fingerprint: await runApiEffect(sha256("public-key-a")) };
      const ticket = {
        ticketHash: "ticket-a",
        userId: "owner",
        serverId: "mobile",
        createdAt: 1000,
        expiresAt: 2000,
        host,
      };
      const redemption = {
        ticketHash: ticket.ticketHash,
        serverId: ticket.serverId,
        now: 1001,
        session: { id: "phone", token: "phone-token", expiresAt: 8_640_000_000_000_000 },
        device: { id: "phone-device", name: "Phone", platform: "ios" as const },
      };
      await runApiEffect(repository.replaceMobileAuthTicket(ticket));
      database.exec("UPDATE remote_hosts SET device_public_key = 'substituted-key' WHERE host_id = 'host-a'");
      await expect(runApiEffect(repository.redeemMobileAuthTicket(redemption))).resolves.toBeNull();
      database.exec("UPDATE remote_hosts SET device_public_key = 'public-key-a' WHERE host_id = 'host-a'");
      await expect(runApiEffect(repository.redeemMobileAuthTicket(redemption))).resolves.toMatchObject({
        host,
        sessionToken: "phone-token",
      });
      expect(await runApiEffect(repository.listAccountSessions("owner", "phone-token", 1001))).toEqual([
        { sessionId: "phone", name: "Phone", kind: "mobile", current: true, connectedAt: 1001, lastActiveAt: 1001 },
      ]);
      await expect(
        runApiEffect(repository.authenticateMobileSession("phone-token", 10_000_000_000_000)),
      ).resolves.toMatchObject({
        id: "owner",
      });
      database.exec(`INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at)
        VALUES ('live-phone', 'host-a', 'owner', 'owner-member', 1001, 8640000000000000)`);
      await expect(runApiEffect(repository.revokeMobileAuthDevice("other-user", "phone", 1002))).resolves.toBe(false);
      expect(database.prepare("SELECT ended_at FROM remote_sessions").get()).toEqual({ ended_at: null });
      await expect(runApiEffect(repository.revokeMobileAuthDevice("owner", "phone", 1003))).resolves.toBe(true);
      await expect(runApiEffect(repository.authenticateMobileSession("phone-token", 1004))).resolves.toBeNull();
      expect(database.prepare("SELECT ended_at FROM remote_sessions").get()).toEqual({ ended_at: 1003 });
      const delivered: unknown[] = [];
      await runApiEffect(
        deliverPendingRemoteAuthEvents(
          {
            DB: db,
            REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
            REMOTE_AUTH_WEBHOOK_SECRET: "s".repeat(32),
          },
          1004,
          async (_url, init) => {
            delivered.push(JSON.parse(String(init?.body)));
            return new Response(null, { status: 204 });
          },
        ),
      );
      expect(delivered).toEqual([{ type: "remote-session-ended", hostId: "host-a", sessionId: "live-phone" }]);
      expect(database.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").get()).toEqual({ count: 0 });
      await runApiEffect(repository.replaceMobileAuthTicket({ ...ticket, ticketHash: "ticket-b" }));
      await runApiEffect(
        repository.redeemMobileAuthTicket({
          ...redemption,
          ticketHash: "ticket-b",
          session: { ...redemption.session, id: "phone-2", token: "phone-token-2" },
        }),
      );
      database.exec(`INSERT INTO remote_sessions(session_id, host_id, user_id, membership_id, started_at, expires_at)
        VALUES ('live-phone-2', 'host-a', 'owner', 'owner-member', 1001, 8640000000000000)`);
      await expect(runApiEffect(repository.revokeMobileSession("phone-token-2", 1005))).resolves.toBe(true);
      expect(database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = 'live-phone-2'").get()).toEqual({
        ended_at: 1005,
      });
    } finally {
      database.close();
    }
  });

  it("returns the existing membership ID and ends live sessions when a member accepts a new invite", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE team_tunnels (
        server_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        tunnel_id TEXT,
        tunnel_name TEXT NOT NULL,
        api_hostname TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        machine_token_hash TEXT
      );
      INSERT INTO users(id) VALUES ('owner'), ('member');
      INSERT INTO team_tunnels(
        server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
      ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, 'machine-hash');
    `);
    database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));
    applyPlanMigrations(database);
    database
      .prepare(
        `INSERT INTO remote_memberships(
          membership_id, host_id, user_id, role, status, created_at, updated_at
        ) VALUES ('existing-member', 'host-1', 'member', 'admin', 'active', 100, 100)`,
      )
      .run();
    database
      .prepare(
        `INSERT INTO remote_sessions(
           session_id, host_id, user_id, membership_id, started_at, expires_at
         ) VALUES ('live-session', 'host-1', 'member', 'existing-member', 100, 5000)`,
      )
      .run();
    const token = "invite-token";
    const tokenHash = Buffer.from(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))).toString(
      "base64url",
    );
    database
      .prepare(
        `INSERT INTO remote_invites(
          invite_id, host_id, token_hash, role, created_by_user_id, expires_at, created_at
        ) VALUES ('invite-1', 'host-1', ?, 'member', 'owner', 2000, 100)`,
      )
      .run(tokenHash);
    const pair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
    const controlPlane = new RemoteControlPlane(
      {
        DB: sqliteD1(database),
        REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
        REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
        REMOTE_TICKET_KEY_ID: "test-key",
      },
      { now: () => 1_000 },
    );
    database.prepare("UPDATE remote_hosts SET device_public_key = 'host-public-key' WHERE host_id = 'host-1'").run();
    await expect(runApiEffect(controlPlane.previewInvite(token))).resolves.toMatchObject({
      hostId: "host-1",
      devicePublicKey: "host-public-key",
    });

    await expect(
      runApiEffect(
        controlPlane.acceptInvite({ id: "member", email: "member@example.com", name: null, avatarUrl: null }, token),
      ),
    ).resolves.toEqual({ hostId: "host-1", membershipId: "existing-member", role: "member" });
    expect(
      database.prepare("SELECT role FROM remote_memberships WHERE membership_id = 'existing-member'").get(),
    ).toEqual({
      role: "member",
    });
    expect(database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = 'live-session'").get()).toEqual({
      ended_at: 1_000,
    });
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").get()).toEqual({ count: 2 });
    expect(database.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get()).toEqual({
      auth_epoch: 2,
    });
    expect(database.prepare("SELECT payload FROM remote_auth_events ORDER BY rowid").all()).toEqual([
      { payload: JSON.stringify({ type: "remote-auth-changed", hostId: "host-1", authEpoch: 2 }) },
      // The device that accepted the invitation has the server already. This is the notice that
      // reaches the same account's other devices, so the join shows up there without a poll.
      { payload: JSON.stringify({ type: "account-servers-changed", userId: "member" }) },
    ]);
  });

  it("protects the owner and validates only an active resume session", async () => {
    const database = new DatabaseSync(":memory:");
    database.exec("PRAGMA foreign_keys = ON");
    database.exec(`
      CREATE TABLE users (id TEXT PRIMARY KEY);
      CREATE TABLE team_auth_tickets(ticket_hash TEXT PRIMARY KEY);
      CREATE TABLE auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        expires_at INTEGER NOT NULL,
        revoked_at INTEGER
      );
      CREATE TABLE team_tunnels (
        server_id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id),
        tunnel_id TEXT,
        tunnel_name TEXT NOT NULL,
        api_hostname TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL,
        machine_token_hash TEXT
      );
      INSERT INTO users(id) VALUES ('owner');
      INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ('owner-auth', 'owner', 5000);
      INSERT INTO team_tunnels(
        server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
      ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, '${"a".repeat(64)}');
    `);
    database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0017_mobile_session_security.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0018_remote_device_sessions.sql", import.meta.url), "utf8"));
    database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));
    applyPlanMigrations(database);
    const pair = await generateKeyPair("ES256", { extractable: true });
    const privateJwk = await exportJWK(pair.privateKey);
    const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
    const webhookBodies: string[] = [];
    let webhookAvailable = true;
    const webhookFetch = async (_input: string | URL | Request, init?: RequestInit) => {
      webhookBodies.push(String(init?.body ?? ""));
      return new Response(null, { status: webhookAvailable ? 204 : 503 });
    };
    const bindings = {
      DB: sqliteD1(database),
      REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
      REMOTE_TICKET_KEY_ID: "test-key",
      REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
      REMOTE_AUTH_WEBHOOK_SECRET: "s".repeat(32),
      SLACK_ROUTE_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      SLACK_ROUTE_KEY_ID: "test-key",
      DISCORD_ROUTE_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
      DISCORD_ROUTE_KEY_ID: "test-key",
    };
    const controlPlane = new RemoteControlPlane(bindings, {
      now: () => 1_000,
      fetch: webhookFetch,
    });
    const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
    const firstRegistration = await runApiEffect(
      controlPlane.registerHost(owner, {
        hostId: "host-1",
        name: "Studio Mac",
        ownerMembershipId: "local-owner",
        devicePublicKey: "public-key-a",
        rotateCredential: false,
      }),
    );
    const registration = await runApiEffect(
      controlPlane.registerHost(owner, {
        hostId: "host-1",
        name: "Studio Mac",
        ownerMembershipId: "local-owner",
        devicePublicKey: "public-key-a",
      }),
    );
    if (!firstRegistration.machineToken || !registration.machineToken) {
      throw new Error("The rotated host credential is missing.");
    }
    expect(registration.authEpoch).toBe(firstRegistration.authEpoch + 1);
    const metadataUpdate = await runApiEffect(
      controlPlane.registerHost(owner, {
        hostId: "host-1",
        name: "Renamed Studio Mac",
        ownerMembershipId: "local-owner",
        devicePublicKey: "public-key-a",
        rotateCredential: false,
        machineToken: registration.machineToken,
      }),
    );
    expect(metadataUpdate).toMatchObject({ authEpoch: registration.authEpoch, machineToken: null });
    // Republishing a host this account already had rotates a credential and changes no server
    // list, so none of these three registrations tells the owner's other devices anything.
    expect(webhookBodies.filter((body) => body.includes("account-servers-changed"))).toEqual([]);
    const mobileHost = { hostId: "host-1", fingerprint: await runApiEffect(sha256("public-key-a")) };
    await expect(runApiEffect(controlPlane.validateMobileConnectHost(owner.id, mobileHost))).resolves.toBeUndefined();
    await expect(
      runApiEffect(controlPlane.validateMobileConnectHost("another-owner", mobileHost)),
    ).rejects.toMatchObject({
      code: "mobile_host_mismatch",
    });
    await expect(
      runApiEffect(
        controlPlane.validateMobileConnectHost(owner.id, {
          ...mobileHost,
          fingerprint: await runApiEffect(sha256("another-key")),
        }),
      ),
    ).rejects.toMatchObject({ code: "mobile_host_mismatch" });
    await expect(
      runApiEffect(controlPlane.issueHostTicket("host-1", registration.machineToken)),
    ).resolves.toMatchObject({
      ticket: expect.any(String),
    });
    await expect(
      runApiEffect(controlPlane.issueHostTicket("host-1", firstRegistration.machineToken)),
    ).rejects.toMatchObject({
      code: "host_unauthorized",
    });
    // A Slack route ticket routes a workspace's messages to a host, so only that host's credential
    // gets one, and it names only the workspaces linked to that host.
    await expect(
      runApiEffect(controlPlane.issueSlackRoute("host-1", firstRegistration.machineToken)),
    ).rejects.toMatchObject({
      code: "host_unauthorized",
    });
    database
      .prepare(
        `INSERT INTO slack_workspace_routes(team_id, host_id, account_id, app_id, bot_user_id, connected_at)
         VALUES ('T1', 'host-1', 'owner', 'A1', 'U1', 1)`,
      )
      .run();
    const route = await runApiEffect(controlPlane.issueSlackRoute("host-1", registration.machineToken));
    expect(route.teams).toEqual(["T1"]);
    expect(decodeJwt(route.ticket)).toMatchObject({
      aud: "openbot-slack-route",
      hid: "host-1",
      teams: [{ id: "T1", appId: "A1", linkedAt: 1 }],
    });
    await expect(
      runApiEffect(controlPlane.disconnectSlackWorkspace("host-1", firstRegistration.machineToken, "T1")),
    ).rejects.toMatchObject({ code: "host_unauthorized" });
    // After Signal starts, it keeps only the links that D1 still has.
    await expect(
      runApiEffect(
        controlPlane.validateSlackRoute({
          hostId: "host-1",
          teams: [
            { id: "T1", appId: "A1", linkedAt: 1 },
            { id: "T2", appId: "A1", linkedAt: 1 },
          ],
        }),
      ),
    ).resolves.toEqual(["T1"]);
    await expect(
      runApiEffect(
        controlPlane.validateSlackRoute({ hostId: "host-1", teams: [{ id: "T1", appId: "A1", linkedAt: 0 }] }),
      ),
    ).resolves.toEqual([]);
    await expect(
      runApiEffect(
        controlPlane.validateSlackRoute({ hostId: "host-2", teams: [{ id: "T1", appId: "A1", linkedAt: 1 }] }),
      ),
    ).resolves.toEqual([]);
    // Another app's link to the same workspace is not this one.
    await expect(
      runApiEffect(
        controlPlane.validateSlackRoute({ hostId: "host-1", teams: [{ id: "T1", appId: "A2", linkedAt: 1 }] }),
      ),
    ).resolves.toEqual([]);
    const revocations = () =>
      webhookBodies.map((body) => JSON.parse(body)).filter((event) => event.type === "slack-route-revoked");
    await runApiEffect(controlPlane.disconnectSlackWorkspace("host-1", registration.machineToken, "T1"));
    expect((await runApiEffect(controlPlane.issueSlackRoute("host-1", registration.machineToken))).teams).toEqual([]);
    // Signal drops the route, so the host cannot keep the workspace with the ticket it holds.
    expect(revocations()).toEqual([
      { type: "slack-route-revoked", appId: "A1", teamId: "T1", through: expect.any(Number) },
    ]);
    await expect(
      runApiEffect(
        controlPlane.validateSlackRoute({ hostId: "host-1", teams: [{ id: "T1", appId: "A1", linkedAt: 1 }] }),
      ),
    ).resolves.toEqual([]);
    await runApiEffect(controlPlane.disconnectSlackWorkspace("host-1", registration.machineToken, "T1"));
    expect(revocations()).toHaveLength(1);
    // The Discord route: the same rules, for the guilds linked to the host.
    await expect(
      runApiEffect(controlPlane.issueDiscordRoute("host-1", firstRegistration.machineToken)),
    ).rejects.toMatchObject({ code: "host_unauthorized" });
    database
      .prepare(
        `INSERT INTO discord_guild_routes(guild_id, host_id, account_id, connected_at)
         VALUES ('111', 'host-1', 'owner', 1)`,
      )
      .run();
    const discordRoute = await runApiEffect(controlPlane.issueDiscordRoute("host-1", registration.machineToken));
    expect(decodeJwt(discordRoute.ticket)).toMatchObject({
      aud: "openbot-discord-route",
      hid: "host-1",
      guilds: [{ id: "111", linkedAt: 1 }],
    });
    await expect(
      runApiEffect(
        controlPlane.validateDiscordRoute({
          hostId: "host-1",
          guilds: [
            { id: "111", linkedAt: 1 },
            { id: "222", linkedAt: 1 },
          ],
        }),
      ),
    ).resolves.toEqual(["111"]);
    await expect(
      runApiEffect(controlPlane.validateDiscordRoute({ hostId: "host-1", guilds: [{ id: "111", linkedAt: 0 }] })),
    ).resolves.toEqual([]);
    await expect(
      runApiEffect(controlPlane.disconnectDiscordGuild("host-1", firstRegistration.machineToken, "111")),
    ).rejects.toMatchObject({ code: "host_unauthorized" });
    const discordRevocations = () =>
      webhookBodies.map((body) => JSON.parse(body)).filter((event) => event.type === "discord-route-revoked");
    await runApiEffect(controlPlane.disconnectDiscordGuild("host-1", registration.machineToken, "111"));
    expect(
      decodeJwt((await runApiEffect(controlPlane.issueDiscordRoute("host-1", registration.machineToken))).ticket),
    ).toMatchObject({ guilds: [] });
    expect(discordRevocations()).toEqual([
      { type: "discord-route-revoked", guildId: "111", through: expect.any(Number) },
    ]);
    await expect(
      runApiEffect(controlPlane.validateDiscordRoute({ hostId: "host-1", guilds: [{ id: "111", linkedAt: 1 }] })),
    ).resolves.toEqual([]);
    await runApiEffect(controlPlane.disconnectDiscordGuild("host-1", registration.machineToken, "111"));
    expect(discordRevocations()).toHaveLength(1);
    // Generic webhook routes keep only opaque ownership metadata in the account service.
    const webhookRegistration = await runApiEffect(
      controlPlane.registerWebhookRoute("host-1", registration.machineToken, "source-1"),
    );
    expect(webhookRegistration).toEqual({ routeId: "source-1" });
    const linkedAt = database.prepare("SELECT connected_at FROM webhook_routes WHERE route_id = 'source-1'").get();
    if (!linkedAt || typeof linkedAt.connected_at !== "number") throw new Error("Missing webhook route timestamp.");
    await expect(
      runApiEffect(controlPlane.registerWebhookRoute("host-1", registration.machineToken, "source-1")),
    ).resolves.toEqual(webhookRegistration);
    expect(database.prepare("SELECT connected_at FROM webhook_routes WHERE route_id = 'source-1'").get()).toEqual(
      linkedAt,
    );
    const webhookTicket = await runApiEffect(controlPlane.issueWebhookRoute("host-1", registration.machineToken));
    expect(decodeJwt(webhookTicket.ticket)).toMatchObject({
      aud: "openbot-webhook-route",
      hid: "host-1",
      routes: [{ id: "source-1", linkedAt: expect.any(Number) }],
    });
    await expect(
      runApiEffect(
        controlPlane.validateWebhookRoute({
          hostId: "host-1",
          routes: [{ id: "source-1", linkedAt: linkedAt.connected_at }],
        }),
      ),
    ).resolves.toEqual(["source-1"]);
    const otherHost = await runApiEffect(
      controlPlane.registerHost(owner, {
        hostId: "host-2",
        name: "Second Mac",
        ownerMembershipId: "local-owner-2",
        devicePublicKey: "public-key-b",
      }),
    );
    if (!otherHost.machineToken) throw new Error("The second host credential is missing.");
    await expect(
      runApiEffect(controlPlane.registerWebhookRoute("host-2", otherHost.machineToken, "source-1")),
    ).rejects.toMatchObject({ code: "webhook_route_conflict" });
    const webhookRevocations = () =>
      webhookBodies.map((body) => JSON.parse(body)).filter((event) => event.type === "webhook-route-revoked");
    await runApiEffect(controlPlane.disconnectWebhookRoute("host-1", registration.machineToken, "source-1"));
    expect(database.prepare("SELECT revoked_at FROM webhook_routes WHERE route_id = 'source-1'").get()).toEqual({
      revoked_at: 1_000,
    });
    expect(webhookRevocations()).toEqual([{ type: "webhook-route-revoked", routeId: "source-1", through: 1_000 }]);
    await runApiEffect(controlPlane.disconnectWebhookRoute("host-1", registration.machineToken, "source-1"));
    expect(webhookRevocations()).toHaveLength(1);
    await expect(
      runApiEffect(
        controlPlane.validateWebhookRoute({
          hostId: "host-1",
          routes: [{ id: "source-1", linkedAt: linkedAt.connected_at }],
        }),
      ),
    ).resolves.toEqual([]);
    // Keep later outbox assertions scoped to the operations after this route-specific fixture.
    webhookBodies.length = 0;
    // Signal reports that the bot left a guild: the link goes without the host.
    database
      .prepare(
        `INSERT INTO discord_guild_routes(guild_id, host_id, account_id, connected_at)
         VALUES ('333', 'host-1', 'owner', 2)`,
      )
      .run();
    await runApiEffect(controlPlane.removeDiscordGuild("333"));
    expect(database.prepare("SELECT guild_id FROM discord_guild_routes WHERE guild_id = '333'").get()).toBeUndefined();
    expect(discordRevocations().at(-1)).toEqual({
      type: "discord-route-revoked",
      guildId: "333",
      through: expect.any(Number),
    });
    // Signal sends the bot's guilds: an older link of another guild goes, a newer one stays.
    database
      .prepare(
        `INSERT INTO discord_guild_routes(guild_id, host_id, account_id, connected_at)
         VALUES ('444', 'host-1', 'owner', 10), ('555', 'host-1', 'owner', 10), ('666', 'host-1', 'owner', 100)`,
      )
      .run();
    await expect(runApiEffect(controlPlane.reconcileDiscordGuilds({ guilds: ["444"], before: 50 }))).resolves.toBe(1);
    expect(
      database.prepare("SELECT guild_id FROM discord_guild_routes WHERE guild_id IN ('444','555','666')").all(),
    ).toEqual([{ guild_id: "444" }, { guild_id: "666" }]);
    expect(discordRevocations().at(-1)).toMatchObject({ guildId: "555" });
    expect(database.prepare("SELECT membership_id FROM remote_memberships WHERE user_id = 'owner'").get()).toEqual({
      membership_id: "host-1:owner",
    });
    const invite = await runApiEffect(controlPlane.createInvite(owner, { hostId: "host-1", role: "member" }));
    await expect(runApiEffect(controlPlane.acceptInvite(owner, invite.token))).rejects.toMatchObject({
      code: "owner_membership_protected",
    });
    expect(database.prepare("SELECT role FROM remote_memberships WHERE user_id = 'owner'").get()).toEqual({
      role: "owner",
    });

    const session = await runApiEffect(controlPlane.startSession(owner.id, "host-1", "owner-auth"));
    await expect(runApiEffect(controlPlane.startSession(owner.id, "host-1", "owner-auth"))).resolves.toEqual(session);
    database
      .prepare("INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ('other-phone', 'owner', 5000)")
      .run();
    const otherPhone = await runApiEffect(controlPlane.startSession(owner.id, "host-1", "other-phone"));
    expect(otherPhone.sessionId).not.toBe(session.sessionId);
    await expect(
      runApiEffect(controlPlane.issueSessionTicket(owner.id, session.sessionId, "public-key", "other-phone")),
    ).rejects.toMatchObject({ code: "session_inactive" });
    await expect(
      runApiEffect(controlPlane.endSession(owner.id, session.sessionId, "other-phone")),
    ).rejects.toMatchObject({
      code: "session_inactive",
    });
    await expect(
      runApiEffect(controlPlane.issueSessionTicket(owner.id, session.sessionId, "public-key", "owner-auth")),
    ).resolves.toMatchObject({ ticket: expect.any(String) });
    await runApiEffect(controlPlane.endAccountSession(owner.id, "other-phone"));
    await expect(
      runApiEffect(controlPlane.issueSessionTicket(owner.id, otherPhone.sessionId, "public-key")),
    ).rejects.toMatchObject({
      code: "session_inactive",
    });
    await expect(runApiEffect(controlPlane.startSession(owner.id, "host-1", "owner-auth"))).resolves.toEqual(session);
    database
      .prepare("INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ('repaired-phone', 'owner', 5000)")
      .run();
    const repaired = await runApiEffect(controlPlane.startSession(owner.id, "host-1", "repaired-phone"));
    expect(repaired.sessionId).not.toBe(otherPhone.sessionId);
    await expect(runApiEffect(controlPlane.startSession(owner.id, "host-1", "owner-auth"))).resolves.toEqual(session);
    const claims = {
      sessionId: session.sessionId,
      hostId: "host-1",
      userId: owner.id,
      membershipId: "host-1:owner",
      role: "owner" as const,
      authEpoch: registration.authEpoch,
      sessionExpiresAt: session.expiresAt / 1_000,
    };
    await expect(runApiEffect(controlPlane.validateResumeClaims(claims))).resolves.toBe(true);
    webhookAvailable = false;
    await runApiEffect(controlPlane.endSession(owner.id, session.sessionId));
    await expect(runApiEffect(controlPlane.validateResumeClaims(claims))).resolves.toBe(false);
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").get()).toEqual({ count: 1 });
    webhookAvailable = true;
    await runApiEffect(deliverPendingRemoteAuthEvents(bindings, 61_001, webhookFetch));
    expect(database.prepare("SELECT COUNT(*) AS count FROM remote_auth_events").get()).toEqual({ count: 0 });
    expect(webhookBodies).toContain(
      JSON.stringify({ type: "remote-session-ended", hostId: "host-1", sessionId: session.sessionId }),
    );

    database.prepare("INSERT INTO users(id) VALUES ('revoked-member')").run();
    database
      .prepare(
        "INSERT INTO auth_sessions(token_hash, user_id, expires_at) VALUES ('member-auth', 'revoked-member', 5000)",
      )
      .run();
    database
      .prepare(
        `INSERT INTO remote_memberships(
           membership_id, host_id, user_id, role, status, created_at, updated_at
         ) VALUES ('revoked-membership', 'host-1', 'revoked-member', 'member', 'revoked', 1, 1)`,
      )
      .run();
    await runApiEffect(
      controlPlane.changeMembership(owner.id, {
        hostId: "host-1",
        membershipId: "revoked-membership",
        role: "admin",
      }),
    );
    expect(
      database.prepare("SELECT role, status FROM remote_memberships WHERE membership_id = 'revoked-membership'").get(),
    ).toEqual({ role: "admin", status: "revoked" });
    await runApiEffect(
      controlPlane.changeMembership(owner.id, {
        hostId: "host-1",
        membershipId: "revoked-membership",
        role: "admin",
        reactivate: true,
      }),
    );
    expect(
      database.prepare("SELECT status FROM remote_memberships WHERE membership_id = 'revoked-membership'").get(),
    ).toEqual({ status: "active" });
    const memberSession = await runApiEffect(controlPlane.startSession("revoked-member", "host-1", "member-auth"));
    await runApiEffect(controlPlane.endSession(owner.id, memberSession.sessionId));
    expect(
      database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = ?").get(memberSession.sessionId),
    ).toEqual({ ended_at: 1_000 });
    const currentAuthEpoch = (await runApiEffect(controlPlane.listHosts(owner.id)))[0]?.authEpoch;
    if (currentAuthEpoch === undefined) throw new Error("The host auth epoch is missing.");
    const hostClaims = {
      sessionId: "host-host-1",
      hostId: "host-1",
      userId: owner.id,
      membershipId: "host-1:host",
      role: "host" as const,
      authEpoch: currentAuthEpoch,
      sessionExpiresAt: 100,
    };
    await expect(
      runApiEffect(controlPlane.validateResumeClaims({ ...hostClaims, authEpoch: currentAuthEpoch - 1 })),
    ).resolves.toBe(false);
    expect(database.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get()).toEqual({
      auth_epoch: currentAuthEpoch,
    });
    await expect(
      runApiEffect(controlPlane.validateResumeClaims({ ...hostClaims, authEpoch: currentAuthEpoch })),
    ).resolves.toBe(true);

    await Promise.all([
      runApiEffect(
        controlPlane.changeMembership(owner.id, {
          hostId: "host-1",
          membershipId: "revoked-membership",
          role: "member",
        }),
      ),
      runApiEffect(
        controlPlane.changeMembership(owner.id, {
          hostId: "host-1",
          membershipId: "revoked-membership",
          role: "admin",
        }),
      ),
    ]);
    expect(database.prepare("SELECT auth_epoch FROM remote_hosts WHERE host_id = 'host-1'").get()).toEqual({
      auth_epoch: currentAuthEpoch + 2,
    });
    expect(webhookBodies).toContain(
      JSON.stringify({ type: "remote-session-ended", hostId: "host-1", sessionId: memberSession.sessionId }),
    );
    const logoutSession = await runApiEffect(controlPlane.startSession("revoked-member", "host-1", "member-auth"));
    webhookAvailable = false;
    await runApiEffect(controlPlane.endAccountSession("revoked-member", "member-auth"));
    await expect(
      runApiEffect(controlPlane.startSession("revoked-member", "host-1", "member-auth")),
    ).rejects.toMatchObject({
      code: "auth_session_revoked",
    });
    expect(
      database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = ?").get(logoutSession.sessionId),
    ).toEqual({ ended_at: 1_000 });
    expect(database.prepare("SELECT revoked_at FROM auth_sessions WHERE token_hash = 'member-auth'").get()).toEqual({
      revoked_at: 1_000,
    });
    expect(
      database
        .prepare(
          "SELECT payload FROM remote_auth_events WHERE payload LIKE '%remote-session-ended%' ORDER BY rowid DESC",
        )
        .get(),
    ).toEqual({
      payload: JSON.stringify({ type: "remote-session-ended", hostId: "host-1", sessionId: logoutSession.sessionId }),
    });
    webhookAvailable = true;
    await runApiEffect(deliverPendingRemoteAuthEvents(bindings, 61_001, webhookFetch));
    await runApiEffect(
      controlPlane.changeMembership("revoked-member", {
        hostId: "host-1",
        membershipId: "revoked-membership",
        revoke: true,
      }),
    );
    expect(
      database.prepare("SELECT status FROM remote_memberships WHERE membership_id = 'revoked-membership'").get(),
    ).toEqual({ status: "revoked" });
    // The member who left, not the owner who owns the host: the server has to leave that account's
    // list on every device it is signed in on.
    expect(webhookBodies).toContain(JSON.stringify({ type: "account-servers-changed", userId: "revoked-member" }));

    database.prepare("INSERT INTO users(id) VALUES ('competing-owner')").run();
    const competingOwner = {
      id: "competing-owner",
      email: "competing@example.com",
      name: null,
      avatarUrl: null,
    };
    const registrations = await Promise.allSettled([
      runApiEffect(
        controlPlane.registerHost(owner, {
          hostId: "race-host",
          name: "Owner host",
          ownerMembershipId: "race-owner-membership",
        }),
      ),
      runApiEffect(
        controlPlane.registerHost(competingOwner, {
          hostId: "race-host",
          name: "Competing host",
          ownerMembershipId: "race-competing-membership",
        }),
      ),
    ]);
    expect(registrations.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(registrations.filter((result) => result.status === "rejected")).toHaveLength(1);
    const successfulRegistration = registrations.find((result) => result.status === "fulfilled");
    if (successfulRegistration?.status !== "fulfilled") {
      throw new Error("Concurrent host registration did not produce a winner.");
    }
    if (!successfulRegistration.value.machineToken) throw new Error("The winning host credential is missing.");
    await expect(
      runApiEffect(controlPlane.issueHostTicket("race-host", successfulRegistration.value.machineToken)),
    ).resolves.toMatchObject({ ticket: expect.any(String) });
    expect(
      database
        .prepare("SELECT COUNT(*) AS count FROM remote_memberships WHERE host_id = 'race-host' AND role = 'owner'")
        .get(),
    ).toEqual({ count: 1 });
    // The one account that gained a server is told once, on the devices it is signed in on. The
    // registration that lost the race gained nothing and tells its owner nothing.
    expect(
      webhookBodies.filter(
        (body) =>
          body === JSON.stringify({ type: "account-servers-changed", userId: "owner" }) ||
          body === JSON.stringify({ type: "account-servers-changed", userId: "competing-owner" }),
      ),
    ).toHaveLength(1);

    const insertInvite = database.prepare(
      `INSERT INTO remote_invites(
         invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at
       ) VALUES (?, 'host-1', ?, NULL, 'member', 'owner', 999999999, 1)`,
    );
    for (let index = 0; index < 49; index += 1) insertInvite.run(`limit-${index}`, `limit-hash-${index}`);
    await expect(
      runApiEffect(controlPlane.createInvite(owner, { hostId: "host-1", role: "member" })),
    ).rejects.toMatchObject({
      code: "invite_limit_reached",
    });
  });

  it("answers a session end before Signal does and keeps the event for the retry", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const migrations = new URL("../migrations/", import.meta.url);
      for (const name of readdirSync(migrations)
        .filter((name) => name.endsWith(".sql"))
        .sort()) {
        database.exec(readFileSync(new URL(name, migrations), "utf8"));
      }
      database.exec(`
        INSERT INTO users(id, identity_key, email, created_at, updated_at) VALUES ('owner', 'email:owner@example.com', 'owner@example.com', 1, 1);
        INSERT INTO remote_hosts(host_id, owner_user_id, name, device_public_key, auth_epoch, created_at, updated_at) VALUES ('host-1', 'owner', 'Desktop', 'public-key', 1, 1, 1);
        INSERT INTO remote_memberships(membership_id, host_id, user_id, role, status, created_at, updated_at) VALUES ('host-1:owner', 'host-1', 'owner', 'owner', 'active', 1, 1);
        INSERT INTO auth_sessions(id, token_hash, user_id, created_at, last_used_at, expires_at) VALUES ('00000000-0000-4000-8000-000000000001', 'owner-auth', 'owner', 1, 1, 8640000000000000);
      `);
      const pair = await generateKeyPair("ES256", { extractable: true });
      const privateJwk = await exportJWK(pair.privateKey);
      const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "end-key", use: "sig", alg: "ES256" };
      const now = 1_000_000;
      const scheduled: Promise<void>[] = [];
      let openGate: () => void = () => undefined;
      const gate = new Promise<void>((resolve) => {
        openGate = resolve;
      });
      const controlPlane = new RemoteControlPlane(
        {
          DB: sqliteD1(database),
          REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "end-key", alg: "ES256" }),
          REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
          REMOTE_TICKET_KEY_ID: "end-key",
          REMOTE_AUTH_WEBHOOK_URL: "https://signal.example.test/internal/auth-events",
          REMOTE_AUTH_WEBHOOK_SECRET: "s".repeat(32),
        },
        {
          now: () => now,
          schedule: (delivery) => {
            scheduled.push(runApiEffect(delivery));
          },
          // Signal answers only after the account has its answer, so an end that waited never returns.
          fetch: async () => {
            await gate;
            throw new Error("Signal is unavailable.");
          },
        },
      );
      const session = await runApiEffect(controlPlane.startSession("owner", "host-1", "owner-auth"));
      await runApiEffect(controlPlane.endSession("owner", session.sessionId, "owner-auth"));

      expect(
        database.prepare("SELECT ended_at FROM remote_sessions WHERE session_id = ?").get(session.sessionId),
      ).toEqual({ ended_at: now });
      expect(scheduled).toHaveLength(1);
      openGate();
      await scheduled[0];
      expect(database.prepare("SELECT payload, attempts, next_attempt_at FROM remote_auth_events").all()).toEqual([
        {
          payload: JSON.stringify({ type: "remote-session-ended", hostId: "host-1", sessionId: session.sessionId }),
          attempts: 1,
          next_attempt_at: now + 60_000,
        },
      ]);
    } finally {
      database.close();
    }
  });
});

describe("permanent invitation links", () => {
  it("stays single-use for invitations written before the permanent-links migration", () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE team_tunnels (
          server_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          tunnel_id TEXT,
          tunnel_name TEXT NOT NULL,
          api_hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          machine_token_hash TEXT
        );
        INSERT INTO users(id) VALUES ('owner');
        INSERT INTO team_tunnels(
          server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
        ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, 'machine-hash');
      `);
      database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
      database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
      database
        .prepare(
          `INSERT INTO remote_invites(
            invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at
          ) VALUES ('legacy', 'host-1', 'legacy-hash', NULL, 'member', 'owner', 999999999, 1)`,
        )
        .run();
      database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));
      // An INSERT from a Worker that does not know the new columns keeps working.
      database
        .prepare(
          `INSERT INTO remote_invites(
            invite_id, host_id, token_hash, email, role, created_by_user_id, expires_at, created_at
          ) VALUES ('deployed-gap', 'host-1', 'gap-hash', NULL, 'member', 'owner', 999999999, 2)`,
        )
        .run();
      expect(database.prepare("SELECT max_uses, use_count FROM remote_invites ORDER BY invite_id").all()).toEqual([
        { max_uses: 1, use_count: 0 },
        { max_uses: 1, use_count: 0 },
      ]);
    } finally {
      database.close();
    }
  });

  it("accepts many joins on one permanent link and caps permanent links separately", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE team_tunnels (
          server_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          tunnel_name TEXT NOT NULL,
          api_hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          machine_token_hash TEXT
        );
        INSERT INTO users(id) VALUES ('owner'), ('alice'), ('bob');
        INSERT INTO team_tunnels(
          server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
        ) VALUES ('host-1', 'owner', 'Studio Mac', 'old.example.test', 'active', 100, 200, 'machine-hash');
      `);
      database.exec(readFileSync(new URL("../migrations/0012_remote_control_plane.sql", import.meta.url), "utf8"));
      database.exec(readFileSync(new URL("../migrations/0013_remote_session_lifecycle.sql", import.meta.url), "utf8"));
      database.exec(readFileSync(new URL("../migrations/0020_permanent_invites.sql", import.meta.url), "utf8"));
      applyPlanMigrations(database);
      const pair = await generateKeyPair("ES256", { extractable: true });
      const privateJwk = await exportJWK(pair.privateKey);
      const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
      const controlPlane = new RemoteControlPlane(
        {
          DB: sqliteD1(database),
          REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
          REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
          REMOTE_TICKET_KEY_ID: "test-key",
        },
        { now: () => 1_000 },
      );
      const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
      const alice = { id: "alice", email: "alice@example.com", name: null, avatarUrl: null };
      const bob = { id: "bob", email: "bob@example.com", name: null, avatarUrl: null };

      await expect(
        runApiEffect(
          controlPlane.createInvite(owner, {
            hostId: "host-1",
            role: "member",
            email: "alice@example.com",
            permanent: true,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });
      await expect(
        runApiEffect(
          controlPlane.createInvite(owner, {
            hostId: "host-1",
            role: "member",
            expiresInSeconds: 3_600,
            permanent: true,
          }),
        ),
      ).rejects.toMatchObject({ status: 400 });

      const invite = await runApiEffect(
        controlPlane.createInvite(owner, { hostId: "host-1", role: "member", permanent: true }),
      );
      expect(invite).toMatchObject({ permanent: true, useCount: 0 });
      expect(invite.expiresAt).toBeGreaterThan(8_000_000_000_000_000);
      await expect(runApiEffect(controlPlane.previewInvite(invite.token))).resolves.toMatchObject({
        permanent: true,
        emailBound: false,
      });

      await expect(runApiEffect(controlPlane.acceptInvite(alice, invite.token))).resolves.toMatchObject({
        hostId: "host-1",
        role: "member",
      });
      await expect(runApiEffect(controlPlane.acceptInvite(bob, invite.token))).resolves.toMatchObject({
        hostId: "host-1",
        role: "member",
      });
      expect(
        database.prepare("SELECT use_count, used_at FROM remote_invites WHERE invite_id = ?").get(invite.inviteId),
      ).toEqual({ use_count: 2, used_at: null });
      await expect(runApiEffect(controlPlane.listInvites("owner", "host-1"))).resolves.toEqual([
        expect.objectContaining({ inviteId: invite.inviteId, permanent: true, useCount: 2, usedAt: null }),
      ]);

      for (let index = 1; index < 5; index += 1) {
        await runApiEffect(controlPlane.createInvite(owner, { hostId: "host-1", role: "member", permanent: true }));
      }
      await expect(
        runApiEffect(controlPlane.createInvite(owner, { hostId: "host-1", role: "member", permanent: true })),
      ).rejects.toMatchObject({ code: "invite_limit_reached" });
      // Permanent links do not consume the single-use budget.
      await expect(
        runApiEffect(controlPlane.createInvite(owner, { hostId: "host-1", role: "member" })),
      ).resolves.toBeDefined();

      await runApiEffect(controlPlane.revokeInvite("owner", invite.inviteId));
      await expect(runApiEffect(controlPlane.previewInvite(invite.token))).rejects.toMatchObject({
        code: "invite_invalid",
      });
      await expect(runApiEffect(controlPlane.acceptInvite(alice, invite.token))).rejects.toMatchObject({
        code: "invite_invalid",
      });
    } finally {
      database.close();
    }
  });
});

describe("member limits per plan", () => {
  it("lets a host have the members of its plan and keeps active members after a downgrade", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      const users = Array.from({ length: 10 }, (_, index) => `user-${index + 1}`);
      database.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE team_tunnels (
          server_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          tunnel_name TEXT NOT NULL,
          api_hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          machine_token_hash TEXT
        );
        INSERT INTO users(id) VALUES ('owner'), ('stranger'), ${users.map((id) => `('${id}')`).join(", ")};
        INSERT INTO team_tunnels(
          server_id, user_id, tunnel_name, api_hostname, status, created_at, updated_at, machine_token_hash
        ) VALUES ('host-1', 'owner', 'Cloud server', 'old.example.test', 'active', 100, 200, 'machine-hash');
      `);
      for (const name of [
        "0012_remote_control_plane.sql",
        "0013_remote_session_lifecycle.sql",
        "0020_permanent_invites.sql",
      ]) {
        database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
      }
      applyPlanMigrations(database);
      const pair = await generateKeyPair("ES256", { extractable: true });
      const privateJwk = await exportJWK(pair.privateKey);
      const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
      const controlPlane = new RemoteControlPlane(
        {
          DB: sqliteD1(database),
          REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
          REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
          REMOTE_TICKET_KEY_ID: "test-key",
        },
        { now: () => 1_000 },
      );
      const owner = { id: "owner", email: "owner@example.com", name: null, avatarUrl: null };
      const member = (id: string) => ({ id, email: `${id}@example.com`, name: null, avatarUrl: null });
      const subscribe = (subscriptionId: string, userId: string, plan: string, status: string) =>
        database
          .prepare(
            `INSERT INTO billing_subscriptions(
               stripe_subscription_id, user_id, stripe_customer_id, server_id, plan, interval, currency, status,
               current_period_end, updated_at
             ) VALUES (?, ?, 'cus_1', 'host-1', ?, 'month', 'eur', ?, 5_000, ?)
             ON CONFLICT(stripe_subscription_id) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`,
          )
          .run(subscriptionId, userId, plan, status, Date.now());
      const limit = async () => (await runApiEffect(controlPlane.listHosts("owner")))[0]?.memberLimit;
      const invite = await runApiEffect(
        controlPlane.createInvite(owner, { hostId: "host-1", role: "member", permanent: true }),
      );

      // No plan: the owner and two members.
      for (const id of users.slice(0, 2)) await runApiEffect(controlPlane.acceptInvite(member(id), invite.token));
      await expect(runApiEffect(controlPlane.acceptInvite(member("user-3"), invite.token))).rejects.toMatchObject({
        code: "member_limit_reached",
        message: "A host can have up to 3 members.",
      });
      expect(await limit()).toBe(3);

      // A plan of another account names this host, so it gives the host nothing.
      subscribe("sub_stranger", "stranger", "pro", "active");
      expect(await limit()).toBe(3);

      // Standard: ten active members, owner included.
      subscribe("sub_owner", "owner", "standard", "active");
      expect(await limit()).toBe(10);
      for (const id of users.slice(2, 9)) await runApiEffect(controlPlane.acceptInvite(member(id), invite.token));
      await expect(runApiEffect(controlPlane.acceptInvite(member("user-10"), invite.token))).rejects.toMatchObject({
        code: "member_limit_reached",
        message: "A host can have up to 10 members.",
      });

      // The plan ends. No member loses the seat, but a revoked member cannot come back.
      subscribe("sub_owner", "owner", "standard", "canceled");
      expect(await limit()).toBe(3);
      const active = () =>
        database.prepare("SELECT COUNT(*) AS count FROM remote_memberships WHERE status = 'active'").get();
      expect(active()).toEqual({ count: 10 });
      const membershipId = String(
        database.prepare("SELECT membership_id FROM remote_memberships WHERE user_id = 'user-9'").get()?.membership_id,
      );
      await runApiEffect(
        controlPlane.changeMembership("owner", {
          hostId: "host-1",
          membershipId,
          role: "admin",
        }),
      );
      await runApiEffect(
        controlPlane.changeMembership("owner", {
          hostId: "host-1",
          membershipId,
          revoke: true,
        }),
      );
      await expect(
        runApiEffect(
          controlPlane.changeMembership("owner", {
            hostId: "host-1",
            membershipId,
            reactivate: true,
          }),
        ),
      ).rejects.toMatchObject({ code: "member_limit_reached" });
      expect(active()).toEqual({ count: 9 });

      // Each active member's devices read the server list again after a plan change.
      database.exec("DELETE FROM remote_auth_events");
      await runApiEffect(controlPlane.planChanged("host-1"));
      expect(
        database
          .prepare("SELECT json_extract(payload, '$.userId') AS userId FROM remote_auth_events ORDER BY userId")
          .all()
          .map((row) => row.userId),
      ).toEqual(["owner", ...users.slice(0, 8)].sort());
    } finally {
      database.close();
    }
  });
});

describe("webhook route tombstones", () => {
  it("never gives a revoked or deleted host's route ID to another host", async () => {
    const database = new DatabaseSync(":memory:");
    try {
      database.exec("PRAGMA foreign_keys = ON");
      database.exec(`
        CREATE TABLE users (id TEXT PRIMARY KEY);
        CREATE TABLE team_tunnels (
          server_id TEXT PRIMARY KEY,
          user_id TEXT NOT NULL REFERENCES users(id),
          tunnel_name TEXT NOT NULL,
          api_hostname TEXT NOT NULL,
          status TEXT NOT NULL,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL,
          machine_token_hash TEXT
        );
        -- A host delete unlinks the owner's hosted sites.
        CREATE TABLE hosted_sites (server_id TEXT, user_id TEXT);
        INSERT INTO users(id) VALUES ('owner'), ('stranger');
      `);
      for (const name of [
        "0012_remote_control_plane.sql",
        "0013_remote_session_lifecycle.sql",
        "0020_permanent_invites.sql",
      ]) {
        database.exec(readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8"));
      }
      applyPlanMigrations(database);
      const pair = await generateKeyPair("ES256", { extractable: true });
      const privateJwk = await exportJWK(pair.privateKey);
      const publicJwk = { ...(await exportJWK(pair.publicKey)), kid: "test-key", use: "sig", alg: "ES256" };
      const controlPlane = new RemoteControlPlane(
        {
          DB: sqliteD1(database),
          REMOTE_TICKET_PRIVATE_JWK: JSON.stringify({ ...privateJwk, kid: "test-key", alg: "ES256" }),
          REMOTE_TICKET_PUBLIC_JWKS: JSON.stringify({ keys: [publicJwk] }),
          REMOTE_TICKET_KEY_ID: "test-key",
        },
        { now: () => 1_000 },
      );
      const account = (id: string) => ({ id, email: `${id}@example.com`, name: null, avatarUrl: null });
      const host = async (user: string, hostId: string) => {
        const registered = await runApiEffect(
          controlPlane.registerHost(account(user), { hostId, name: hostId, ownerMembershipId: `${hostId}:${user}` }),
        );
        if (!registered.machineToken) throw new Error("The host credential is missing.");
        return registered.machineToken;
      };
      const ownerToken = await host("owner", "host-1");
      await runApiEffect(controlPlane.registerWebhookRoute("host-1", ownerToken, "revoked-route"));
      await runApiEffect(controlPlane.registerWebhookRoute("host-1", ownerToken, "deleted-host-route"));
      await runApiEffect(controlPlane.disconnectWebhookRoute("host-1", ownerToken, "revoked-route"));
      // The owner's own host cannot revive a revoked URL either.
      await expect(
        runApiEffect(controlPlane.registerWebhookRoute("host-1", ownerToken, "revoked-route")),
      ).rejects.toMatchObject({ code: "webhook_route_conflict" });

      const strangerToken = await host("stranger", "host-2");
      await expect(
        runApiEffect(controlPlane.registerWebhookRoute("host-2", strangerToken, "revoked-route")),
      ).rejects.toMatchObject({ code: "webhook_route_conflict" });

      // A deleted host frees its host ID, but not its route IDs.
      await runApiEffect(controlPlane.deleteHost("owner", "host-1"));
      const reusedHostToken = await host("stranger", "host-1");
      await expect(
        runApiEffect(controlPlane.registerWebhookRoute("host-1", reusedHostToken, "deleted-host-route")),
      ).rejects.toMatchObject({ code: "webhook_route_conflict" });
      await expect(runApiEffect(controlPlane.issueWebhookRoute("host-1", reusedHostToken))).resolves.toMatchObject({
        routes: [],
      });
      await expect(
        runApiEffect(
          controlPlane.validateWebhookRoute({
            hostId: "host-1",
            routes: [{ id: "deleted-host-route", linkedAt: 1_000 }],
          }),
        ),
      ).resolves.toEqual([]);
    } finally {
      database.close();
    }
  });
});
