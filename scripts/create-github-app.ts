import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger, registerSecretValue, toLogValue } from "@openbot/logging";
import { z } from "zod";

/**
 * Creates the GitHub App that the built-in GitHub connection signs in to, from
 * `scripts/github-app/manifest.json`, with the GitHub App manifest flow.
 *
 *   bun scripts/create-github-app.ts [--org <organization>]
 *
 * The script serves one page on 127.0.0.1. The page sends the manifest to GitHub, GitHub asks you to
 * confirm the app, and then sends you back here with a code. The script trades that code for the
 * app's settings. It prints the Client ID, which is public, and writes the client secret, the private
 * key and the webhook secret to `~/.config/openbot/github-app-<slug>.json` with mode 0600. OpenBot
 * does not use them: keep them in a password manager.
 *
 * https://docs.github.com/en/apps/sharing-github-apps/registering-a-github-app-from-a-manifest
 */

const logger = createOpenBotLogger("create-github-app");
/** GitHub accepts the code for one hour. The script waits for less. */
const WAIT_MS = 30 * 60_000;
const MANIFEST_PATH = resolve(import.meta.dirname, "github-app/manifest.json");

/** The fields that this script checks. GitHub reads the rest of the manifest as it is. */
const manifestSchema = z.looseObject({ name: z.string().min(1), url: z.string().url() });

const conversionSchema = z.object({
  id: z.number(),
  slug: z.string().regex(/^[a-z0-9-]+$/u),
  client_id: z.string().min(1),
  client_secret: z.string().min(1),
  webhook_secret: z.string().nullable(),
  pem: z.string().min(1),
  html_url: z.string().url(),
});

type Conversion = z.infer<typeof conversionSchema>;

function organizationArgument(argv: readonly string[]): string | null {
  const index = argv.indexOf("--org");
  if (index === -1) return null;
  const organization = argv[index + 1];
  if (!organization || !/^[A-Za-z0-9-]+$/u.test(organization)) {
    throw new Error("--org needs the login of a GitHub organization.");
  }
  return organization;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll('"', "&quot;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function page(response: ServerResponse, status: number, body: string): void {
  response.writeHead(status, {
    "Content-Type": "text/html; charset=utf-8",
    "Cache-Control": "no-store",
    "Referrer-Policy": "no-referrer",
  });
  response.end(`<!doctype html><meta charset="utf-8"><title>OpenBot GitHub App</title>${body}`);
}

async function convert(code: string): Promise<Conversion> {
  const response = await fetch(`https://api.github.com/app-manifests/${encodeURIComponent(code)}/conversions`, {
    method: "POST",
    headers: { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" },
  });
  if (!response.ok) throw new Error(`GitHub refused the manifest code (HTTP ${response.status}).`);
  const conversion = conversionSchema.parse(await response.json());
  for (const secret of [conversion.client_secret, conversion.webhook_secret, conversion.pem]) {
    if (secret) registerSecretValue(secret);
  }
  return conversion;
}

async function saveSecrets(conversion: Conversion): Promise<string> {
  const directory = join(homedir(), ".config", "openbot");
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const secrets = {
    id: conversion.id,
    slug: conversion.slug,
    clientId: conversion.client_id,
    clientSecret: conversion.client_secret,
    webhookSecret: conversion.webhook_secret,
    privateKey: conversion.pem,
  };
  const contents = `${JSON.stringify(secrets, null, 2)}\n`;
  // `wx`: a second run never replaces the secrets of an app that the first run created. GitHub
  // shows these secrets once, so a file that is already there gets a sibling, not an error.
  const path = join(directory, `github-app-${conversion.slug}.json`);
  try {
    await writeFile(path, contents, { mode: 0o600, flag: "wx" });
    return path;
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
  }
  const sibling = join(directory, `github-app-${conversion.slug}-${Date.now()}.json`);
  await writeFile(sibling, contents, { mode: 0o600, flag: "wx" });
  return sibling;
}

function openInBrowser(url: string): void {
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  const child = spawn(command, [url], { stdio: "ignore", detached: true });
  child.on("error", () => undefined);
  child.unref();
}

async function main(): Promise<void> {
  const organization = organizationArgument(process.argv.slice(2));
  const manifest = manifestSchema.parse(JSON.parse(await readFile(MANIFEST_PATH, "utf8")));
  const state = randomBytes(16).toString("hex");
  const target = organization
    ? `https://github.com/organizations/${organization}/settings/apps/new`
    : "https://github.com/settings/apps/new";

  const conversion = await new Promise<Conversion>((resolveConversion, reject) => {
    let origin = "";
    let settled = false;
    /** GitHub accepts a code once. A second answer, such as a reload of the page, is refused here. */
    let converting = false;
    const finish = (result: { conversion: Conversion } | { error: unknown }) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      server.close();
      if ("conversion" in result) resolveConversion(result.conversion);
      else reject(result.error);
    };
    const handle = async (request: IncomingMessage, response: ServerResponse) => {
      const url = new URL(request.url ?? "/", origin);
      if (request.method !== "GET") return page(response, 405, "<p>Method not allowed.</p>");
      if (url.pathname === "/") {
        const body = JSON.stringify({ ...manifest, redirect_url: `${origin}/done` });
        return page(
          response,
          200,
          `<form id="manifest" method="post" action="${escapeHtml(`${target}?state=${state}`)}">` +
            `<input type="hidden" name="manifest" value="${escapeHtml(body)}">` +
            `<p>Sending the OpenBot manifest to GitHub…</p><button type="submit">Continue to GitHub</button></form>` +
            `<script>document.getElementById("manifest").submit()</script>`,
        );
      }
      if (url.pathname !== "/done") return page(response, 404, "<p>Not found.</p>");
      const code = url.searchParams.get("code");
      if (url.searchParams.get("state") !== state || !code) {
        return page(response, 400, "<p>This answer is not from the request that this script sent.</p>");
      }
      if (converting) return page(response, 409, "<p>This script already has the answer. Look in the terminal.</p>");
      converting = true;
      try {
        const result = await convert(code);
        page(response, 200, "<p>GitHub created the app. Go back to the terminal for the next steps.</p>");
        finish({ conversion: result });
      } catch (error) {
        page(response, 502, "<p>GitHub did not give the app settings. Look in the terminal.</p>");
        finish({ error });
      }
    };
    const server = createServer((request, response) => {
      void handle(request, response).catch((error: unknown) => finish({ error }));
    });
    const timeout = setTimeout(() => finish({ error: new Error("No answer came from GitHub in time.") }), WAIT_MS);
    server.on("error", (error) => finish({ error }));
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") return finish({ error: new Error("No loopback port.") });
      origin = `http://127.0.0.1:${address.port}`;
      logger.info(`Open ${origin}/ if the browser does not open.`);
      openInBrowser(`${origin}/`);
    });
  });

  // The public settings first: they stay on the terminal if the secrets cannot be written.
  logger.info(`GitHub created the app ${conversion.slug}: ${conversion.html_url}`);
  logger.info("Put the Client ID in GITHUB_APP_CLIENT_ID in src/main/github-connector-config.ts:");
  process.stdout.write(`${conversion.client_id}\n`);
  let secretsPath: string;
  try {
    secretsPath = await saveSecrets(conversion);
  } catch (error) {
    logger.error(
      "The secrets were not written. Generate a new client secret and private key in the app settings.",
      toLogValue(error),
    );
    process.exitCode = 1;
    return;
  }
  logger.info(`The secrets are in ${secretsPath} (mode 0600). OpenBot does not use them.`);
  logger.info("Do these steps in the app settings. A manifest cannot do them:");
  logger.info("  1. General > Identifying and authorizing users: select Enable Device Flow.");
  logger.info("  2. Optional features: opt out of User-to-server token expiration.");
  if (conversion.slug !== "openbotgit") {
    logger.info(`GitHub gave the slug ${conversion.slug}. Put it in GITHUB_APP_SLUG too.`);
  }
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    logger.error("The GitHub App was not created.", toLogValue(error));
    process.exitCode = 1;
  });
}
