import { randomBytes } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { SaveCustomProviderInput } from "@openbot/contracts/ipc";
import { redactPostText, redactText } from "@openbot/logging";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runCauseEffect } from "../backend/effect-boundary";
import { type CustomProviderCipher, CustomProviderStore } from "./custom-provider-store";

const cipher: CustomProviderCipher = {
  canPersist: () => true,
  encrypt: (value) => Buffer.from(value, "utf8").reverse(),
  decrypt: (value) => Buffer.from(value).reverse().toString("utf8"),
};

const unprefixed = (label: string) => `${label}${randomBytes(8).toString("hex")}`;

let directory: string;

beforeEach(async () => {
  directory = await mkdtemp(join(tmpdir(), "openbot-custom-provider-redaction-"));
});

afterEach(async () => {
  await rm(directory, { recursive: true, force: true });
});

function store(): CustomProviderStore {
  return new CustomProviderStore({ path: join(directory, "custom-providers.json"), cipher });
}

function input(apiKey: string, headerValue: string): SaveCustomProviderInput {
  return {
    id: "studio",
    name: "Studio",
    baseUrl: "https://llm.example.test/v1",
    apiKey,
    models: [{ id: "studio-large", name: "Studio Large" }],
    headers: [{ name: "Ocp-Apim-Subscription-Key", value: headerValue }],
  };
}

describe("CustomProviderStore redaction", () => {
  it("masks a saved key and header value with no known prefix", async () => {
    const apiKey = unprefixed("studio");
    const header = unprefixed("tenant");
    const saving = store();
    await runCauseEffect(saving.load());
    await runCauseEffect(saving.save(input(apiKey, header)));

    const line = redactText(`OpenCode failed: key ${apiKey}, subscription ${header}`);
    expect(line).not.toContain(apiKey);
    expect(line).not.toContain(header);
  });

  it("masks a key and header value that an update sets", async () => {
    const updating = store();
    await runCauseEffect(updating.load());
    await runCauseEffect(updating.save(input(unprefixed("first"), unprefixed("first"))));
    const apiKey = unprefixed("second");
    const header = unprefixed("second");
    await runCauseEffect(
      updating.update({
        id: "studio",
        name: "Studio",
        baseUrl: "https://llm.example.test/v1",
        models: [{ id: "studio-large", name: "Studio Large" }],
        apiKey,
        headers: [{ name: "Ocp-Apim-Subscription-Key", value: header }],
      }),
    );

    const line = redactText(`OpenCode failed: ${apiKey} ${header}`);
    expect(line).not.toContain(apiKey);
    expect(line).not.toContain(header);
  });

  it("keeps public header values readable and masks the others", async () => {
    const secret = unprefixed("tenant");
    const saving = store();
    await runCauseEffect(saving.load());
    await runCauseEffect(
      saving.save({
        ...input(unprefixed("public"), unprefixed("public")),
        headers: [
          { name: "Content-Type", value: "application/json" },
          { name: "HTTP-Referer", value: "https://studio.example.test/app" },
          { name: "X-Title", value: "OpenBotStudio" },
          { name: "X-Portkey-Provider", value: "anthropic" },
          { name: "X-Gateway-Key", value: "letmeinplease" },
          { name: "X-Tenant", value: secret },
        ],
      }),
    );

    const text = `Send application/json from https://studio.example.test/app as OpenBotStudio to anthropic for ${secret}`;
    const expected =
      "Send application/json from https://studio.example.test/app as OpenBotStudio to anthropic for [redacted]";
    expect(redactPostText(text)).toBe(expected);
    expect(redactText(text)).toContain("application/json");
    expect(redactText(text)).toContain("OpenBotStudio");
    expect(redactText(text)).not.toContain(secret);
    expect(redactText("gateway letmeinplease")).toBe("gateway [redacted]");
  });

  it("stops masking the values of an endpoint that is removed", async () => {
    const apiKey = unprefixed("removed");
    const header = unprefixed("removed");
    const removing = store();
    await runCauseEffect(removing.load());
    await runCauseEffect(removing.save(input(apiKey, header)));
    expect(redactText(`${apiKey} ${header}`)).toBe("[redacted] [redacted]");

    await runCauseEffect(removing.remove("studio"));

    expect(redactText(`${apiKey} ${header}`)).toBe(`${apiKey} ${header}`);
  });

  it("masks the values of a file that a load opens", async () => {
    const apiKey = unprefixed("loaded");
    const header = unprefixed("loaded");
    const secret = JSON.stringify({ apiKey, headers: [{ name: "X-Portkey-Virtual-Key", value: header }] });
    await writeFile(
      join(directory, "custom-providers.json"),
      JSON.stringify({
        version: 1,
        providers: [
          {
            id: "studio",
            name: "Studio",
            baseUrl: "https://llm.example.test/v1",
            models: [{ id: "studio-large", name: "Studio Large" }],
            secret: cipher.encrypt(secret).toString("base64"),
          },
        ],
      }),
    );
    expect(redactText(`${apiKey} ${header}`)).toBe(`${apiKey} ${header}`);

    await runCauseEffect(store().load());

    expect(redactText(`${apiKey} ${header}`)).toBe("[redacted] [redacted]");
  });
});
