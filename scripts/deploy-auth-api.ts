import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";

const logger = createOpenBotLogger("deploy-auth-api");

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsRoot, "..");
const apiRoot = join(projectRoot, "apps", "auth-api");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const bunExecutable = process.execPath;
// Bun installs the workspace binaries at the repository root.
const wranglerExecutable = join(projectRoot, "node_modules", ".bin", `wrangler${executableSuffix}`);
const cloudflareEnvironment = readCloudflareEnvironment(process.argv.slice(2));
const environmentArgs = cloudflareEnvironment ? ["--env", cloudflareEnvironment] : [];

async function main(): Promise<void> {
  await putRequiredSecret("EMAIL_SMTP_PASSWORD");
  await putRequiredSecret("SKILLS_ADMIN_TOKEN");
  await putRequiredSecret("SITE_REPORT_HASH_SECRET");
  await putRequiredSecret("REMOTE_TICKET_PRIVATE_JWK");
  await putRequiredSecret("REMOTE_TICKET_PUBLIC_JWKS");
  await putRequiredSecret("REMOTE_AUTH_WEBHOOK_SECRET");
  assertStripeKeyMode();
  await putOptionalSecretSet("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET");
  await putOptionalSecretSet("BOAT_API_KEY", "BOAT_WEBHOOK_SECRET");
  // Production releases own the template. Test deployments keep their separate setting.
  if (cloudflareEnvironment === "test") await putOptionalSecret("HOSTED_SERVER_TEMPLATE");
  // Without the key, agents act on GitHub as the signed-in user and not as the OpenBot GitHub App.
  await putOptionalSecret("GITHUB_APP_PRIVATE_KEY");
  // Slack is optional: without these, the Slack routes answer 503 slack_not_configured. The test
  // Worker takes the development app's values from the .env.dev file.
  await putOptionalSecretSet("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_STATE_SECRET");
  await putOptionalSecretSet("SLACK_ROUTE_PRIVATE_JWK", "SLACK_ROUTE_KEY_ID");
  // Discord is optional too: without these, the Discord routes answer 503 discord_not_configured.
  await putOptionalSecretSet("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_STATE_SECRET");
  await putOptionalSecretSet("DISCORD_ROUTE_PRIVATE_JWK", "DISCORD_ROUTE_KEY_ID");
  if (cloudflareEnvironment === "test") {
    await putTestAllowList();
    // The key is in the encrypted .env.dev file. Each developer who can decrypt it can create servers.
    await putOptionalSecret("HOSTED_SERVERS_DEVELOPER_KEY");
  }
  // Only production sends account events, so a test Worker does not add events to the production project.
  if (!cloudflareEnvironment) await putOptionalSecretSet("OPENPANEL_CLIENT_ID", "OPENPANEL_CLIENT_SECRET");
  // The Live Activity relay stays off until the Apple key is in the environment.
  await putOptionalSecretSet("APNS_PRIVATE_KEY", "APNS_KEY_ID");
  await run(wranglerExecutable, ["d1", "migrations", "apply", "DB", "--remote", ...environmentArgs], {
    label: "Remote D1 migrations",
  });
  await run(bunExecutable, ["run", "build"], {
    label: "Auth API build",
    env: cloudflareEnvironment ? { CLOUDFLARE_ENV: cloudflareEnvironment } : undefined,
  });
  await run(wranglerExecutable, ["deploy", "--keep-vars", ...environmentArgs], {
    label: "Auth API deployment",
  });
}

async function putRequiredSecret(name: string): Promise<void> {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is missing from the decrypted production environment.`);
  // dotenvx keeps the ciphertext when .env.keys has no matching private key.
  if (value.startsWith("encrypted:"))
    throw new Error(`${name} is not decrypted. Check the environment decryption key.`);
  await run(wranglerExecutable, ["secret", "put", name, ...environmentArgs], {
    input: `${value}\n`,
    label: `${name} secret`,
  });
}

/** A test Worker must never take real payments, and production must never take test payments. */
function assertStripeKeyMode(): void {
  const key = process.env.STRIPE_SECRET_KEY?.trim();
  if (!key) return;
  const live = key.startsWith("sk_live_") || key.startsWith("rk_live_");
  if (cloudflareEnvironment && live) {
    throw new Error(`STRIPE_SECRET_KEY is a live key. The ${cloudflareEnvironment} Worker takes only test keys.`);
  }
  if (!cloudflareEnvironment && !live)
    throw new Error("STRIPE_SECRET_KEY is not a live key. Production takes only live keys.");
}

/**
 * The test Worker is public and shares its boat account with production, so only the accounts in
 * the encrypted `HOSTED_SERVERS_TEST_ALLOW_LIST` (account IDs or emails), and a request with the
 * developer key, can create servers there. Production allows each account with a var in
 * wrangler.jsonc, and a var and a secret cannot have one name.
 */
async function putTestAllowList(): Promise<void> {
  const value = process.env.HOSTED_SERVERS_TEST_ALLOW_LIST?.trim();
  if (!value) {
    logger.info("HOSTED_SERVERS_TEST_ALLOW_LIST is not set. The Worker keeps its current allow list.");
    return;
  }
  if (value.startsWith("encrypted:")) throw new Error("HOSTED_SERVERS_TEST_ALLOW_LIST is not decrypted.");
  if (value.split(",").some((entry) => entry.trim() === "*")) {
    throw new Error("HOSTED_SERVERS_TEST_ALLOW_LIST must name accounts, not `*`.");
  }
  await run(wranglerExecutable, ["secret", "put", "HOSTED_SERVERS_ALLOWED_USER_IDS", ...environmentArgs], {
    input: `${value}\n`,
    label: "HOSTED_SERVERS_ALLOWED_USER_IDS secret",
  });
}

async function putOptionalSecret(name: string): Promise<void> {
  if (process.env[name]?.trim()) await putRequiredSecret(name);
}

/**
 * Billing, hosting and account events are optional: the Worker turns each off without its secrets.
 * Set all or none of a set. A Stripe or boat key without its webhook secret takes payments or makes
 * sandboxes that the Worker never sees.
 */
async function putOptionalSecretSet(...names: string[]): Promise<void> {
  const present = names.filter((name) => process.env[name]?.trim());
  if (present.length === 0) {
    logger.info(`${names.join(", ")} are not set. The Worker keeps its current values.`);
    return;
  }
  if (present.length !== names.length) {
    throw new Error(`Set all of ${names.join(", ")} in the decrypted production environment, or none.`);
  }
  for (const name of names) await putRequiredSecret(name);
}

async function run(
  executable: string,
  args: string[],
  options: { env?: NodeJS.ProcessEnv; input?: string; label: string },
): Promise<void> {
  await new Promise<void>((resolveProcess, rejectProcess) => {
    const environment = { ...process.env, ...options.env };
    if (executable === wranglerExecutable) delete environment.CLOUDFLARE_API_TOKEN;
    const child = spawn(executable, args, {
      cwd: apiRoot,
      env: environment,
      shell: false,
      stdio: [options.input === undefined ? "inherit" : "pipe", "inherit", "inherit"],
    });
    child.once("error", rejectProcess);
    child.once("exit", (code, signal) => {
      if (code === 0) resolveProcess();
      else {
        rejectProcess(new Error(`${options.label} failed with ${signal ? `signal ${signal}` : `code ${code ?? 1}`}.`));
      }
    });
    if (options.input !== undefined) child.stdin?.end(options.input);
  });
}

function readCloudflareEnvironment(args: string[]): string | null {
  if (args.length === 0) return null;
  if (args.length === 2 && args[0] === "--env" && /^[a-z0-9-]+$/u.test(args[1] ?? "")) {
    return args[1] ?? null;
  }
  throw new Error("Use --env followed by a lowercase Cloudflare environment name.");
}

void main().catch((error) => {
  logger.error("Auth API deployment failed.", toLogValue(error));
  process.exitCode = 1;
});
