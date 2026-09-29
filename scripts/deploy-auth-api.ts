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
  // An unset value keeps the value that the Worker has: a new template is set for each release.
  await putOptionalSecret("HOSTED_SERVER_TEMPLATE");
  // Only production sends account events, so a test Worker does not add events to the production project.
  if (!cloudflareEnvironment) await putOptionalSecretSet("OPENPANEL_CLIENT_ID", "OPENPANEL_CLIENT_SECRET");
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
  if (value.startsWith("encrypted:")) throw new Error(`${name} is not decrypted. Check the private key in .env.keys.`);
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
