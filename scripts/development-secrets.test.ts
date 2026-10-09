import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importJWK, jwtVerify, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDevelopmentDefaults,
  createDevelopmentTicketKeyPair,
  ensureDevelopmentState,
  readDevelopmentState,
  setDevelopmentOverrides,
} from "./development-secrets";

const temporaryRoots: string[] = [];

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("generated development secrets", () => {
  it("issues a ticket the published JWKS can verify", async () => {
    const { privateJwk, publicJwks } = createDevelopmentTicketKeyPair();
    const signingKey = await importJWK(JSON.parse(privateJwk), "ES256");
    const [published] = JSON.parse(publicJwks).keys;

    const ticket = await new SignJWT({ sessionId: "session-1" })
      .setProtectedHeader({ alg: "ES256", kid: published.kid })
      .sign(signingKey);
    const verified = await jwtVerify(ticket, await importJWK(published, "ES256"));

    expect(verified.payload.sessionId).toBe("session-1");
  });

  it("claims the ticket key ID that wrangler.jsonc pins", () => {
    const { publicJwks } = createDevelopmentTicketKeyPair();

    expect(JSON.parse(publicJwks).keys[0].kid).toBe("openbot-remote-1");
  });

  it("writes secrets the Signal service accepts, and a different set each time", () => {
    const [first, second] = [createDevelopmentDefaults(), createDevelopmentDefaults()];

    for (const name of ["SKILLS_ADMIN_TOKEN", "SITE_REPORT_HASH_SECRET", "REMOTE_AUTH_WEBHOOK_SECRET"]) {
      expect(new TextEncoder().encode(first[name]).byteLength).toBeGreaterThanOrEqual(32);
      expect(first[name]).not.toBe(second[name]);
    }
  });

  it("turns email delivery off and exposes the development sign-in code", () => {
    const values = createDevelopmentDefaults();

    expect(values.AUTH_EXPOSE_DEVELOPMENT_CODE).toBe("true");
    expect([
      values.EMAIL_SMTP_HOST,
      values.EMAIL_SMTP_PORT,
      values.EMAIL_SMTP_USERNAME,
      values.EMAIL_FROM,
      values.EMAIL_SMTP_PASSWORD,
    ]).toEqual(["", "", "", "", ""]);
  });

  it("never imports the encrypted development settings into local state", () => {
    const root = createTemporaryRoot();
    const path = join(root, "apps", "auth-api", ".env.dev");
    const source = "REMOTE_TICKET_PRIVATE_JWK=encrypted:fixture\n";
    writeFileSync(path, source);

    const state = readDevelopmentState(root);
    expect(state.defaults.REMOTE_TICKET_PRIVATE_JWK).not.toBe("encrypted:fixture");
    expect(state.overrides).toEqual({});
    expect(statSync(join(root, ".openbot", "dev-state.json")).mode & 0o777).toBe(0o600);
    expect(readFileSync(path, "utf8")).toBe(source);
    expect(existsSync(join(root, ".openbot", "legacy-env.dev.backup"))).toBe(false);
  });

  it("generates local defaults into state when the checkout has no state", () => {
    const root = createTemporaryRoot();

    expect(ensureDevelopmentState(root)).toBe("created");
    const state = readDevelopmentState(root);
    expect(state.version).toBe(1);
    expect(state.defaults.REMOTE_TICKET_PRIVATE_JWK).toBeTruthy();
    expect(state.overrides).toEqual({});
    expect(exists(join(root, "apps", "auth-api", ".env.dev"))).toBe(false);
  });

  it("preserves state across restarts and writes overrides atomically", () => {
    const root = createTemporaryRoot();

    const first = readDevelopmentState(root);
    const updated = setDevelopmentOverrides(root, { APNS_KEY_ID: "ABC1234567", APNS_PRIVATE_KEY: "private-key" });
    const second = readDevelopmentState(root);

    expect(second.defaults.REMOTE_TICKET_PRIVATE_JWK).toBe(first.defaults.REMOTE_TICKET_PRIVATE_JWK);
    expect(updated.overrides).toEqual({ APNS_KEY_ID: "ABC1234567", APNS_PRIVATE_KEY: "private-key" });
    expect(setDevelopmentOverrides(root, { APNS_PRIVATE_KEY: null }).overrides).toEqual({ APNS_KEY_ID: "ABC1234567" });
  });

  it("rejects corrupted state without generating a replacement", () => {
    const root = createTemporaryRoot();
    mkdirSync(join(root, ".openbot"), { recursive: true });
    writeFileSync(join(root, ".openbot", "dev-state.json"), "not-json\n");

    expect(() => readDevelopmentState(root)).toThrow(/state file is invalid/i);
    expect(readFileSync(join(root, ".openbot", "dev-state.json"), "utf8")).toBe("not-json\n");
  });

  it("rejects a state file without the stable ticket identity", () => {
    const root = createTemporaryRoot();
    mkdirSync(join(root, ".openbot"), { recursive: true });
    writeFileSync(join(root, ".openbot", "dev-state.json"), '{"version":1,"defaults":{},"overrides":{}}\n');

    expect(() => readDevelopmentState(root)).toThrow(/state file has an invalid format/i);
  });

  it("reports an active state lock without deleting it", () => {
    const root = createTemporaryRoot();
    mkdirSync(join(root, ".openbot", "dev-state.json.lock"), { recursive: true });

    expect(() => readDevelopmentState(root)).toThrow(/dev-state\.json\.lock.*do not delete/i);
    expect(exists(join(root, ".openbot", "dev-state.json.lock"))).toBe(true);
  });
});

function exists(path: string): boolean {
  return existsSync(path);
}

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-dev-secrets-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "auth-api"), { recursive: true });
  return root;
}
