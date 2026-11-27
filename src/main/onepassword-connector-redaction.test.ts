import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { redactText } from "@openbot/logging";
import { Effect } from "effect";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { BrowserDiagnostics } from "../backend/browser-diagnostics";
import { type OnePasswordClient, OnePasswordConnectorService } from "./onepassword-connector-service";
import { OnePasswordConnectorStore } from "./onepassword-connector-store";

const ORIGIN = "https://login.example.test";
const SHORT_PASSWORD = "q4!p2x";
const OTP = "729104";

const cipher = {
  encrypt: (value: string) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value: Buffer) => Buffer.from(value).reverse().toString("utf8"),
};

const websites = [{ url: ORIGIN, autofillBehavior: "AnywhereOnWebsite" }];

const client: OnePasswordClient = {
  vaults: { list: async () => [{ id: "vault-1", title: "OpenBot" }] },
  items: {
    list: async () => [{ id: "login-1", title: "Example", category: "Login", websites }],
    get: async () => ({
      websites,
      fields: [
        { id: "password", fieldType: "Concealed", value: SHORT_PASSWORD },
        { id: "otp", fieldType: "Totp", value: "", details: { type: "Otp", content: { code: OTP } } },
      ],
    }),
  },
};

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-onepassword-redaction-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

async function connectedService(): Promise<OnePasswordConnectorService> {
  const store = new OnePasswordConnectorStore(join(directory, "onepassword.json"), cipher);
  await Effect.runPromise(store.write({ token: "ops_test-service-account-token", accountId: null, connectedAt: 0 }));
  return new OnePasswordConnectorService({
    store,
    hostName: "test-host",
    appVersion: "0.0.0",
    cliInstall: null,
    openExternal: async () => undefined,
    createClient: async () => client,
  });
}

describe("1Password connector redaction", () => {
  it("masks a short password and a six-digit code that it fills", async () => {
    const service = await connectedService();
    expect(redactText(`value ${SHORT_PASSWORD} ${OTP}`)).toBe(`value ${SHORT_PASSWORD} ${OTP}`);

    const password = await Effect.runPromise(service.secretFor("login-1", ORIGIN, "password"));
    const code = await Effect.runPromise(service.secretFor("login-1", ORIGIN, "totp"));
    expect([password, code]).toEqual([SHORT_PASSWORD, OTP]);

    const diagnostics = new BrowserDiagnostics();
    diagnostics.add({ kind: "console", level: "warning", message: `Sign-in callback value ${SHORT_PASSWORD}` });
    diagnostics.add({ kind: "console", level: "warning", message: `Sign-in callback value ${OTP}` });
    expect(diagnostics.snapshot().diagnostics.map((entry) => entry.message)).toEqual([
      "Sign-in callback value [redacted]",
      "Sign-in callback value [redacted]",
    ]);
    await Effect.runPromise(service.dispose());
  });
});
