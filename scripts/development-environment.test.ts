import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseEnv } from "node:util";
import { set } from "@dotenvx/dotenvx";
import { afterEach, describe, expect, it } from "vitest";
import {
  developmentChildEnvironment,
  developmentSettingsForService,
  loadDevelopmentEnvironment,
  loadSharedDevelopmentEnvironment,
  loadTestDeploymentEnvironment,
  requireDevelopmentValues,
} from "./development-environment";
import { readDevelopmentState, setDevelopmentOverrides } from "./development-secrets";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});
function fixture(): string {
  const root = mkdtempSync(join(tmpdir(), "openbot-environment-"));
  roots.push(root);
  mkdirSync(join(root, "apps/auth-api"), { recursive: true });
  return root;
}
async function encryptedFixture(root: string): Promise<string> {
  const path = join(root, "apps/auth-api/.env.dev");
  writeFileSync(path, "");
  const envKeysFile = join(root, ".fixture.keys");
  const options = { path, envKeysFile, quiet: true };
  await set("STRIPE_SECRET_KEY", "sk_test_fixture", options);
  await set("REMOTE_AUTH_WEBHOOK_SECRET", "shared-identity-must-not-win", options);
  const key = parseEnv(readFileSync(envKeysFile, "utf8")).DOTENV_PRIVATE_KEY_DEV;
  if (!key) throw new Error("Fixture key is missing.");
  return key;
}

describe("development environment loading", () => {
  it("starts without shared keys and keeps identity when shared access changes", async () => {
    const root = fixture();
    const key = await encryptedFixture(root);
    const without = await loadDevelopmentEnvironment(root, {});
    expect(without.STRIPE_SECRET_KEY).toBeUndefined();
    const withKey = await loadDevelopmentEnvironment(root, { DOTENV_PRIVATE_KEY_DEV: key });
    expect(withKey.STRIPE_SECRET_KEY).toBe("sk_test_fixture");
    expect(withKey.REMOTE_AUTH_WEBHOOK_SECRET).toBe(without.REMOTE_AUTH_WEBHOOK_SECRET);
    expect(withKey.REMOTE_TICKET_PRIVATE_JWK).toBe(without.REMOTE_TICKET_PRIVATE_JWK);
    expect(withKey.DOTENV_PRIVATE_KEY_DEV).toBeUndefined();
    expect(await loadDevelopmentEnvironment(root, {})).toEqual(without);
  });

  it("preserves saved and shell overrides, including empty values", async () => {
    const root = fixture();
    const key = await encryptedFixture(root);
    setDevelopmentOverrides(root, { STRIPE_SECRET_KEY: "", CUSTOM_SETTING: "saved" });
    const saved = await loadDevelopmentEnvironment(root, { DOTENV_PRIVATE_KEY_DEV: key });
    expect(saved.STRIPE_SECRET_KEY).toBe("");
    const shell = await loadDevelopmentEnvironment(root, {
      DOTENV_PRIVATE_KEY_DEV: key,
      CUSTOM_SETTING: "",
      STRIPE_SECRET_KEY: "shell",
    });
    expect(shell.STRIPE_SECRET_KEY).toBe("shell");
    expect(shell.CUSTOM_SETTING).toBe("");
  });

  it("rejects an invalid key without including it in the error", async () => {
    const root = fixture();
    await encryptedFixture(root);
    await expect(
      loadSharedDevelopmentEnvironment(root, { DOTENV_PRIVATE_KEY_DEV: "private-invalid-fixture" }),
    ).rejects.toThrow(/^Cannot decrypt shared development settings\. Check the development key\.$/u);
  });

  it("rejects damaged ciphertext even when the shell overrides its value", async () => {
    const root = fixture();
    const key = await encryptedFixture(root);
    writeFileSync(join(root, "apps/auth-api/.env.dev"), 'STRIPE_SECRET_KEY="encrypted:broken"\n');
    await expect(
      loadDevelopmentEnvironment(root, { DOTENV_PRIVATE_KEY_DEV: key, STRIPE_SECRET_KEY: "shell" }),
    ).rejects.toThrow("Cannot decrypt shared development settings");
  });

  it("does not pass decryption or account credentials to the app or Signal", () => {
    const source = {
      DOTENV_PRIVATE_KEY_DEV: "private",
      DOTENV_PRIVATE_KEY_PRODUCTION: "private-prod",
      STRIPE_SECRET_KEY: "stripe",
      OPENBOT_DEV_SLACK_SIGNING_SECRET: "slack-signing",
      REMOTE_TICKET_PRIVATE_JWK: "signer",
      REMOTE_TICKET_PUBLIC_JWKS: "verifier",
      REMOTE_AUTH_WEBHOOK_SECRET: "webhook",
      REMOTE_SESSION_SECRET: "session",
      TURN_SHARED_SECRET: "turn",
      TELEGRAM_BOT_TOKENS: "telegram-token",
      TELEGRAM_BOT_ID: "telegram-bot",
      PATH: "/bin",
    };
    const app = developmentChildEnvironment(source, "app");
    expect(app).toEqual({ PATH: "/bin" });
    const signal = developmentChildEnvironment(source, "remote");
    expect(signal).toEqual({
      REMOTE_TICKET_PUBLIC_JWKS: "verifier",
      REMOTE_AUTH_WEBHOOK_SECRET: "webhook",
      REMOTE_SESSION_SECRET: "session",
      TURN_SHARED_SECRET: "turn",
      TELEGRAM_BOT_TOKENS: "telegram-token",
      PATH: "/bin",
    });
    expect(developmentChildEnvironment(source, "api").DOTENV_PRIVATE_KEY_PRODUCTION).toBeUndefined();
  });

  it("does not give arbitrary saved integration settings to unrelated services", () => {
    const settings = { CUSTOM_INTEGRATION_SECRET: "private", REMOTE_TICKET_PUBLIC_JWKS: "public" };
    expect(developmentSettingsForService(settings, "app")).toEqual({});
    expect(developmentSettingsForService(settings, "remote")).toEqual({ REMOTE_TICKET_PUBLIC_JWKS: "public" });
    expect(developmentSettingsForService(settings, "api")).toEqual(settings);
  });

  it("rejects absent external settings before a command can run", () => {
    expect(() => requireDevelopmentValues({}, ["STRIPE_SECRET_KEY"])).toThrow(
      "Missing development settings: STRIPE_SECRET_KEY.",
    );
    expect(() => requireDevelopmentValues({ STRIPE_SECRET_KEY: "encrypted:fixture" }, ["STRIPE_SECRET_KEY"])).toThrow(
      "Missing development settings",
    );
  });

  it("keeps local state out of test deployment", async () => {
    const root = fixture();
    const key = await encryptedFixture(root);
    const path = join(root, "apps/auth-api/.env.production");
    const production = {
      EMAIL_SMTP_PASSWORD: "smtp",
      SKILLS_ADMIN_TOKEN: "admin",
      SITE_REPORT_HASH_SECRET: "report",
      REMOTE_TICKET_PRIVATE_JWK: "production-signer",
      REMOTE_TICKET_PUBLIC_JWKS: "production-verifier",
      REMOTE_AUTH_WEBHOOK_SECRET: "production-webhook",
      STRIPE_SECRET_KEY: "sk_test_production_fixture",
      STRIPE_WEBHOOK_SECRET: "stripe-webhook",
      BOAT_API_KEY: "boat",
      BOAT_WEBHOOK_SECRET: "boat-webhook",
      HOSTED_SERVERS_DEVELOPER_KEY: "developer",
      HOSTED_SERVERS_TEST_ALLOW_LIST: "account-id",
    };
    writeFileSync(path, "");
    const envKeysFile = join(root, ".production-fixture.keys");
    const options = { path, envKeysFile, quiet: true };
    for (const [name, value] of Object.entries(production)) await set(name, value, options);
    const productionKey = parseEnv(readFileSync(envKeysFile, "utf8")).DOTENV_PRIVATE_KEY_PRODUCTION;
    if (!productionKey) throw new Error("Production fixture key is missing.");
    setDevelopmentOverrides(root, { STRIPE_SECRET_KEY: "local-override", SKILLS_ADMIN_TOKEN: "local-admin" });
    const result = await loadTestDeploymentEnvironment(root, {
      DOTENV_PRIVATE_KEY_DEV: key,
      DOTENV_PRIVATE_KEY_PRODUCTION: productionKey,
    });
    expect(result.STRIPE_SECRET_KEY).toBe("sk_test_fixture");
    expect(result.SKILLS_ADMIN_TOKEN).toBe("admin");
    expect(result.REMOTE_TICKET_PRIVATE_JWK).toBe("production-signer");
    expect(result.REMOTE_AUTH_WEBHOOK_SECRET).toBe("shared-identity-must-not-win");
    expect(readDevelopmentState(root).overrides.SKILLS_ADMIN_TOKEN).toBe("local-admin");
    expect(result.DOTENV_PRIVATE_KEY_DEV).toBeUndefined();
    expect(result.DOTENV_PRIVATE_KEY_PRODUCTION).toBeUndefined();
    const shell = await loadTestDeploymentEnvironment(root, {
      DOTENV_PRIVATE_KEY_DEV: key,
      DOTENV_PRIVATE_KEY_PRODUCTION: productionKey,
      STRIPE_SECRET_KEY: "sk_test_shell_fixture",
    });
    expect(shell.STRIPE_SECRET_KEY).toBe("sk_test_shell_fixture");
  });
});
