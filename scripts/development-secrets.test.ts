import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { importJWK, jwtVerify, SignJWT } from "jose";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDevelopmentEnvFile,
  createDevelopmentTicketKeyPair,
  ensureDevelopmentEnvFile,
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
    const [first, second] = [readGeneratedValues(), readGeneratedValues()];

    for (const name of ["SKILLS_ADMIN_TOKEN", "SITE_REPORT_HASH_SECRET", "REMOTE_AUTH_WEBHOOK_SECRET"]) {
      expect(new TextEncoder().encode(first[name]).byteLength).toBeGreaterThanOrEqual(32);
      expect(first[name]).not.toBe(second[name]);
    }
  });

  it("turns email delivery off and exposes the development sign-in code", () => {
    const values = readGeneratedValues();

    expect(values.AUTH_EXPOSE_DEVELOPMENT_CODE).toBe("true");
    expect([
      values.EMAIL_SMTP_HOST,
      values.EMAIL_SMTP_PORT,
      values.EMAIL_SMTP_USERNAME,
      values.EMAIL_FROM,
      values.EMAIL_SMTP_PASSWORD,
    ]).toEqual(["", "", "", "", ""]);
  });

  it("keeps an env file that already exists", () => {
    const root = createTemporaryRoot();
    const path = join(root, "apps", "auth-api", ".env.dev");
    writeFileSync(path, "SKILLS_ADMIN_TOKEN=the-developer-own-value\n");

    expect(ensureDevelopmentEnvFile(root)).toBe("kept");
    expect(readFileSync(path, "utf8")).toBe("SKILLS_ADMIN_TOKEN=the-developer-own-value\n");
  });

  it("generates an env file when the checkout has none", () => {
    const root = createTemporaryRoot();

    expect(ensureDevelopmentEnvFile(root)).toBe("created");
    expect(readFileSync(join(root, "apps", "auth-api", ".env.dev"), "utf8")).toContain("REMOTE_TICKET_PRIVATE_JWK=");
  });
});

function readGeneratedValues(): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of createDevelopmentEnvFile().split("\n")) {
    if (line.startsWith("#") || !line.includes("=")) continue;
    const separator = line.indexOf("=");
    values[line.slice(0, separator)] = line.slice(separator + 1);
  }
  return values;
}

function createTemporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-dev-secrets-"));
  temporaryRoots.push(root);
  mkdirSync(join(root, "apps", "auth-api"), { recursive: true });
  return root;
}
