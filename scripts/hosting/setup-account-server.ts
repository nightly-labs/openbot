/**
 * Sets up Stripe and boat for the hosted servers of one account server, and stores each secret that
 * it makes. Run it again at any time: it changes only what differs.
 *
 *   read -rs STRIPE_SECRET_KEY && read -rs BOAT_API_KEY && export STRIPE_SECRET_KEY BOAT_API_KEY
 *   bun run hosting:setup --target=production
 *
 *   bun run hosting:setup --target=test
 *
 * - Stripe: the catalog, the Customer Portal and the webhook endpoint (`scripts/stripe-bootstrap.ts`).
 * - boat: the webhook to `<api>/v2/hosting/boat/webhook` with each event that the Worker reads.
 *
 * Stripe and boat show a webhook signing secret only when they make it. When the store does not have
 * that secret, or with `--replace-webhooks`, the script makes a new one: it replaces the Stripe
 * endpoint and rotates the boat secret. Until the Worker has the new secret, it refuses the
 * deliveries; Stripe retries them, and the Worker cron repairs a missed boat event.
 *
 * The production store is the `cloudflare-production` GitHub Environment (`gh` must be signed in),
 * and the keys come from the shell. The test store is the encrypted `apps/auth-api/.env.dev`,
 * and the keys come from the shared development environment. The script shows no secret value.
 */

import { execFile } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { set as dotenvSet } from "@dotenvx/dotenvx";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { z } from "zod";
import { loadSharedDevelopmentEnvironment } from "../development-environment";
import { bootstrapStripe } from "../stripe-bootstrap";

const logger = createOpenBotLogger("hosting-setup");
const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const BOAT_API_URL = "https://boat.dev/api/v1";
/** The events that `HostedServerService` reads from a boat webhook delivery. */
const BOAT_EVENTS = ["sandbox.ready", "sandbox.error", "sandbox.archived", "sandbox.hydrated"];
const GITHUB_ENVIRONMENT = "cloudflare-production";
const TARGETS = {
  production: { api: "https://api.openbot.run" },
  test: { api: "https://openbot-auth-api-test.internal9671.workers.dev" },
} as const;

interface SecretStore {
  readonly label: string;
  /** The value, or null when the store cannot show it or does not have it. */
  read(name: string): Promise<string | null>;
  has(name: string): Promise<boolean>;
  put(name: string, value: string): Promise<void>;
}

function run(command: string, args: string[], input = ""): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = execFile(command, args, { cwd: repoRoot }, (error, stdout, stderr) => {
      // A value goes on standard input, so the command line and the error hold no secret.
      if (error)
        reject(new Error(`${command} ${args.slice(0, 2).join(" ")} failed: ${stderr.trim() || error.message}`));
      else resolve(stdout);
    });
    child.stdin?.end(input);
  });
}

function githubStore(): SecretStore {
  let names: Promise<Set<string>> | null = null;
  const list = (): Promise<Set<string>> => {
    names ??= run("gh", ["secret", "list", "--env", GITHUB_ENVIRONMENT, "--json", "name"]).then(
      (stdout) =>
        new Set(
          z
            .array(z.object({ name: z.string() }))
            .parse(JSON.parse(stdout))
            .map(({ name }) => name),
        ),
    );
    return names;
  };
  return {
    label: `the ${GITHUB_ENVIRONMENT} GitHub Environment`,
    read: async () => null,
    has: async (name) => (await list()).has(name),
    put: async (name, value) => {
      await run("gh", ["secret", "set", name, "--env", GITHUB_ENVIRONMENT], value);
      (await list()).add(name);
    },
  };
}

function envFileStore(path: string): SecretStore {
  const envPath = join(repoRoot, path);
  const read = async (name: string): Promise<string | null> => {
    const values = await loadSharedDevelopmentEnvironment(repoRoot);
    return values[name]?.trim() || null;
  };
  const put = async (name: string, value: string): Promise<void> => {
    const privateKey = process.env.DOTENV_PRIVATE_KEY_DEV?.trim();
    if (!privateKey) {
      throw new Error(`${name} was not written to ${path}. Set DOTENV_PRIVATE_KEY_DEV in the shell.`);
    }
    const keysDirectory = mkdtempSync(join(tmpdir(), "openbot-dotenv-"));
    const keysPath = join(keysDirectory, ".env.keys");
    writeFileSync(keysPath, `DOTENV_PRIVATE_KEY_DEV=${privateKey}\n`, { encoding: "utf8", mode: 0o600 });
    try {
      const options = { path: envPath, envKeysFile: keysPath, quiet: true };
      let result: Awaited<ReturnType<typeof dotenvSet>>;
      try {
        result = await dotenvSet(name, value, options);
      } catch {
        throw new Error(`${name} was not written to ${path}. Check the development private key.`);
      }
      if (result.changedFilepaths.length === 0 && result.unchangedFilepaths.length === 0) {
        throw new Error(`${name} was not written to ${path}. Check the development private key.`);
      }
    } finally {
      rmSync(keysDirectory, { recursive: true, force: true });
    }
  };
  return { label: path, read, has: async (name) => (await read(name)) !== null, put };
}

async function requiredKey(store: SecretStore, name: string): Promise<string> {
  const value = process.env[name]?.trim() || (await store.read(name));
  if (!value) throw new Error(`Set ${name}. Use read -rs ${name} && export ${name}, so the key is not in the history.`);
  return value;
}

const boatWebhookSchema = z.object({ id: z.string(), url: z.string(), events: z.array(z.string()) });
const boatWebhookListSchema = z.object({ webhooks: z.array(boatWebhookSchema) });
const boatSecretSchema = z.object({
  secret: z.string().optional(),
  webhook: z.object({ secret: z.string().optional() }).optional(),
});

async function boat<T>(apiKey: string, method: string, path: string, body: unknown, schema: z.ZodType<T>): Promise<T> {
  const response = await fetch(`${BOAT_API_URL}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/json",
      ...(body === undefined ? {} : { "Content-Type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(20_000),
  });
  const value = await response.json().catch(() => null);
  if (!response.ok) {
    const code = z.object({ error: z.object({ code: z.string() }) }).safeParse(value).data?.error.code;
    throw new Error(`boat ${method} ${path} failed with ${response.status} ${code ?? ""}`.trim());
  }
  return schema.parse(value);
}

function boatSecret(value: z.infer<typeof boatSecretSchema>): string {
  const secret = value.secret ?? value.webhook?.secret;
  if (!secret) throw new Error("boat did not return the webhook signing secret.");
  return secret;
}

/** Returns a new signing secret, or null when the webhook keeps the secret that the store has. */
async function ensureBoatWebhook(apiKey: string, url: string, name: string, rotate: boolean): Promise<string | null> {
  const { webhooks } = await boat(apiKey, "GET", "/webhooks", undefined, boatWebhookListSchema);
  const current = webhooks.find((webhook) => webhook.url === url);
  if (!current) {
    const created = await boat(apiKey, "POST", "/webhooks", { name, url, events: BOAT_EVENTS }, boatSecretSchema);
    logger.info(`Created the boat webhook to ${url}.`);
    return boatSecret(created);
  }
  if (current.events.length !== BOAT_EVENTS.length || BOAT_EVENTS.some((event) => !current.events.includes(event))) {
    await boat(apiKey, "PATCH", `/webhooks/${current.id}`, { events: BOAT_EVENTS }, z.unknown());
    logger.info(`Set the events of the boat webhook ${current.id}.`);
  }
  if (!rotate) {
    logger.info(`The boat webhook ${current.id} is up to date. Its signing secret did not change.`);
    return null;
  }
  const rotated = await boat(apiKey, "POST", `/webhooks/${current.id}/rotate`, undefined, boatSecretSchema);
  logger.info(`Rotated the signing secret of the boat webhook ${current.id}.`);
  return boatSecret(rotated);
}

async function main(args: string[]): Promise<void> {
  const { values } = parseArgs({
    args,
    options: {
      target: { type: "string" },
      api: { type: "string" },
      "replace-webhooks": { type: "boolean", default: false },
    },
    strict: true,
  });
  const target = values.target;
  if (target !== "production" && target !== "test") throw new Error("Add --target=production or --target=test.");
  const live = target === "production";
  const api = new URL(values.api ?? TARGETS[target].api).origin;
  const replace = values["replace-webhooks"];
  const store = live ? githubStore() : envFileStore("apps/auth-api/.env.dev");
  if (!live) {
    const privateKey = process.env.DOTENV_PRIVATE_KEY_DEV?.trim();
    if (!privateKey) {
      throw new Error("Set DOTENV_PRIVATE_KEY_DEV in the shell before updating the test store.");
    }
    await loadSharedDevelopmentEnvironment(repoRoot);
  }
  const written: string[] = [];
  const put = async (name: string, value: string): Promise<void> => {
    await store.put(name, value);
    written.push(name);
  };

  const stripeKey = await requiredKey(store, "STRIPE_SECRET_KEY");
  if (live && !/^(sk|rk)_live_/u.test(stripeKey)) throw new Error("STRIPE_SECRET_KEY is not a live-mode key.");
  const boatKey = await requiredKey(store, "BOAT_API_KEY");
  // The production keys come from the shell. The CI deploy refuses a pair with one value.
  if (live) {
    await put("STRIPE_SECRET_KEY", stripeKey);
    await put("BOAT_API_KEY", boatKey);
  }

  // Each secret is stored at once: Stripe and boat do not show it again.
  const stripeSecret = await bootstrapStripe({
    secretKey: stripeKey,
    live,
    webhookUrl: `${api}/v1/stripe/webhook`,
    replaceWebhook: replace || !(await store.has("STRIPE_WEBHOOK_SECRET")),
  });
  if (stripeSecret) await put("STRIPE_WEBHOOK_SECRET", stripeSecret);

  const boatSecretValue = await ensureBoatWebhook(
    boatKey,
    `${api}/v2/hosting/boat/webhook`,
    `openbot-${target}`,
    replace || !(await store.has("BOAT_WEBHOOK_SECRET")),
  );
  if (boatSecretValue) await put("BOAT_WEBHOOK_SECRET", boatSecretValue);

  logger.info(written.length ? `Wrote ${written.join(", ")} to ${store.label}.` : `${store.label} did not change.`);
  const next: string[] = [];
  if (written.length > 0) {
    next.push(
      live
        ? "The next push to main deploys the new values to the Worker."
        : "Run bun run api:deploy:test to send the new values to the test Worker.",
    );
  }
  next.push(
    "Stripe Dashboard: in Revenue recovery → Retries, set 'If all retries for a payment fail' to cancel the subscription or to mark it unpaid.",
  );
  if (live) {
    next.push("The desktop release workflow selects HOSTED_SERVER_TEMPLATE directly on the production Worker.");
    if (!(await store.has("OPENPANEL_CLIENT_ID"))) {
      next.push("Optional: set OPENPANEL_CLIENT_ID and OPENPANEL_CLIENT_SECRET with gh secret set --env.");
    }
  }
  for (const line of next) logger.info(line);
}

if (import.meta.main) {
  void main(process.argv.slice(2)).catch((error) => {
    logger.error("Hosting setup failed.", toLogValue(error));
    process.exitCode = 1;
  });
}
