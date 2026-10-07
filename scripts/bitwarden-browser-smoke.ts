import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Effect } from "effect";
import { webContents } from "electron";
import type { BrowserHost } from "../src/backend/browser-host";
import { runCauseEffect } from "../src/backend/effect-boundary";
import { passwordVaultRouter } from "../src/backend/password-vault-router";
import { BitwardenConnectorService } from "../src/main/bitwarden-connector-service";
import { waitForPresentedFrame } from "./browser-smoke-frames";

const ORIGIN = "https://authentication.openbot.test";
const ID = "12345678-1234-1234-1234-123456789abc";
const PASSWORD = "fixture-bitwarden-password";
const CODE = "739182";

/** The page submits only if the browser received the expected fixture value. */
export function bitwardenLoginFixture(kind: "password" | "authenticator"): Response {
  const expected = kind === "password" ? PASSWORD : CODE;
  return new Response(
    `<!doctype html><form method="post" action="/complete" onsubmit="if(document.querySelector('input').value!==${JSON.stringify(expected).replaceAll('"', "&quot;")}){event.preventDefault()}">
    <label>Secret<input id="vault-secret" type="${kind === "password" ? "password" : "text"}" autocomplete="${kind === "password" ? "current-password" : "one-time-code"}"></label>
    <button id="vault-submit">Sign in</button></form>`,
    { headers: { "Content-Type": "text/html" } },
  );
}

/** Real browser and vault router; the injected CLI contains only synthetic credentials. */
export async function runBitwardenBrowserSmoke(browser: BrowserHost): Promise<void> {
  const connector = new BitwardenConnectorService({
    findCli: async () => "/fixture/bw",
    runCli: async (_executable, args) => {
      if (args[0] === "sync") return "Sync complete.";
      if (args[1] === "folders")
        return JSON.stringify([
          { id: null, name: "No Folder" },
          { id: "shared", name: "Shared with OpenBot" },
        ]);
      if (args[1] === "totp") return CODE;
      const item = {
        id: ID,
        name: "Fixture",
        type: 1,
        folderId: "shared",
        reprompt: 0,
        login: {
          username: "fixture@example.test",
          password: PASSWORD,
          totp: "fixture-seed",
          uris: [{ uri: ORIGIN, match: 0 }],
        },
      };
      return JSON.stringify(args[1] === "items" ? [item] : item);
    },
  });
  const vault = passwordVaultRouter(
    { connected: () => false, loginsFor: () => Effect.succeed(null), secretFor: () => Effect.succeed(null) },
    connector,
  );
  const checks: string[] = [];
  try {
    await runCauseEffect(connector.connect("fixture-session-key"));
    const logins = await runCauseEffect(vault.loginsFor(ORIGIN));
    const login = logins?.[0];
    if (!login || JSON.stringify(logins).includes(PASSWORD) || JSON.stringify(logins).includes(CODE))
      throw new Error("Invalid vault metadata.");
    checks.push("metadata contains no credential values");
    for (const method of ["password", "authenticator"] as const) {
      const tab = await runCauseEffect(browser.open(`${ORIGIN}/bitwarden-${method}`, "secret-thread", "secret-agent"));
      try {
        const contents = webContents.getAllWebContents().find((entry) => entry.getURL() === tab.url);
        if (!contents) throw new Error("Missing Bitwarden fixture page.");
        await waitForPresentedFrame(contents);
        const prepared = await runCauseEffect(
          browser.prepareSecret({
            namespace: "openbot_browser",
            tool: "submit_secret",
            threadId: "secret-thread",
            ownerAgentId: "secret-agent",
            turnId: "secret-turn",
            callId: `bitwarden-${method}`,
            arguments: {
              tabId: tab.id,
              method,
              digits: 6,
              targets: [{ kind: "css", selector: "#vault-secret" }],
              submission: "click",
              submitTarget: { kind: "css", selector: "#vault-submit" },
            },
          }),
        );
        if (!prepared.vaultFillable || prepared.agentScriptedOrigin)
          throw new Error("Vault fixture is not safe to fill.");
        const value = await runCauseEffect(
          vault.secretFor(login.id, prepared.request.origin, method === "password" ? "password" : "totp"),
        );
        if (!value || (await runCauseEffect(prepared.submit(value))) !== "submitted")
          throw new Error("Bitwarden fixture did not submit.");
        const snapshot = await runCauseEffect(browser.snapshot(tab.id));
        if (!snapshot.url.endsWith("/complete") || JSON.stringify(snapshot).includes(value))
          throw new Error("Bitwarden sign-in failed or exposed its value.");
        checks.push(`${method} signs in without exposing the value in the snapshot`);
      } finally {
        await runCauseEffect(browser.close(tab.id));
      }
    }
    await runCauseEffect(connector.disconnect());
    if (await runCauseEffect(vault.secretFor(login.id, ORIGIN, "password")))
      throw new Error("Disconnected vault returned a password.");
    checks.push("disconnect blocks further reads");
    const directory = join(process.cwd(), ".openbot-build", "bitwarden");
    await mkdir(directory, { recursive: true });
    await writeFile(
      join(directory, "browser-smoke.json"),
      JSON.stringify({ passed: true, source: "synthetic CLI", checks }, null, 2),
    );
  } finally {
    await runCauseEffect(connector.disconnect());
  }
}
