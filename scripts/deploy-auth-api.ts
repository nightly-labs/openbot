import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createOpenBotLogger, toLogValue } from "@openbot/logging";
import { readFcmServiceAccount } from "../apps/auth-api/src/server/android-notification-relay";

const logger = createOpenBotLogger("deploy-auth-api");

const scriptsRoot = dirname(fileURLToPath(import.meta.url));
const projectRoot = join(scriptsRoot, "..");
const apiRoot = join(projectRoot, "apps", "auth-api");
const executableSuffix = process.platform === "win32" ? ".exe" : "";
const bunExecutable = process.execPath;
const wranglerExecutable = join(projectRoot, "node_modules", ".bin", `wrangler${executableSuffix}`);
const cloudflareEnvironment = readCloudflareEnvironment(process.argv.slice(2));
const environmentArgs = cloudflareEnvironment ? ["--env", cloudflareEnvironment] : [];

async function main(): Promise<void> {
  if (!cloudflareEnvironment) {
    requiredSecret("OPENPANEL_CLIENT_ID");
    requiredSecret("OPENPANEL_CLIENT_SECRET");
    assertLandingBeam();
  }
  assertFcmServiceAccount();
  await putRequiredSecret("EMAIL_SMTP_PASSWORD");
  await putRequiredSecret("SKILLS_ADMIN_TOKEN");
  await putRequiredSecret("SITE_REPORT_HASH_SECRET");
  await putRequiredSecret("REMOTE_TICKET_PRIVATE_JWK");
  await putRequiredSecret("REMOTE_TICKET_PUBLIC_JWKS");
  await putRequiredSecret("REMOTE_AUTH_WEBHOOK_SECRET");
  assertStripeKeyMode();
  await putOptionalSecretSet("STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET");
  await putOptionalSecretSet("BOAT_API_KEY", "BOAT_WEBHOOK_SECRET");
  if (cloudflareEnvironment === "test") await putOptionalSecret("HOSTED_SERVER_TEMPLATE");
  await putOptionalSecret("GITHUB_APP_PRIVATE_KEY");
  await putOptionalSecret("COMPANY_SIGN_IN_SECRET");
  await putOptionalSecretSet("HOSTED_ARCHIVE_KEY_SECRET", "B2_WORKER_KEY_ID_EU", "B2_WORKER_APPLICATION_KEY_EU");
  await putOptionalSecret("SERVER_CLAIMS_ADMIN_TOKEN");
  await putOptionalSecretSet("STORE_REVIEW_EMAIL", "STORE_REVIEW_CODE");
  if (!cloudflareEnvironment) await putOptionalSecret("HOSTED_POOL_ALERT_WEBHOOK_URL");
  await putOptionalSecretSet("SLACK_CLIENT_ID", "SLACK_CLIENT_SECRET", "SLACK_STATE_SECRET");
  await putOptionalSecretSet("SLACK_ROUTE_PRIVATE_JWK", "SLACK_ROUTE_KEY_ID");
  await putOptionalSecretSet("DISCORD_CLIENT_ID", "DISCORD_CLIENT_SECRET", "DISCORD_STATE_SECRET");
  await putOptionalSecretSet("DISCORD_ROUTE_PRIVATE_JWK", "DISCORD_ROUTE_KEY_ID");
  await putOptionalSecretSet("TELEGRAM_BOT_ID", "TELEGRAM_BOT_USERNAME");
  if (cloudflareEnvironment === "test") {
    await putTestAllowList();
    await putOptionalSecret("HOSTED_SERVERS_DEVELOPER_KEY");
  }
  if (!cloudflareEnvironment) {
    await putRequiredSecret("OPENPANEL_CLIENT_ID");
    await putRequiredSecret("OPENPANEL_CLIENT_SECRET");
  }
  await putOptionalSecretSet("APNS_PRIVATE_KEY", "APNS_KEY_ID");
  await putOptionalSecret("FCM_SERVICE_ACCOUNT");
  await run(wranglerExecutable, ["d1", "migrations", "apply", "DB", "--remote", ...environmentArgs], {
    label: "Remote D1 migrations",
  });
  await run(bunExecutable, ["run", "build"], {
    label: "Auth API build",
    env: cloudflareEnvironment ? { CLOUDFLARE_ENV: cloudflareEnvironment } : undefined,
  });
  if (!cloudflareEnvironment) {
    await run(bunExecutable, [join(apiRoot, "scripts", "keep-previous-assets.ts")], {
      label: "Earlier code files",
    });
  }
  if (!cloudflareEnvironment) {
    await run(wranglerExecutable, ["deploy", "--config", "wrangler.email-relay.jsonc"], {
      label: "Email relay deployment",
    });
  }
  await run(wranglerExecutable, ["deploy", "--keep-vars", ...environmentArgs], {
    label: "Auth API deployment",
  });
}

function assertLandingBeam(): void {
  const port = join(apiRoot, "src", "vendor", "laser-flow", "LandingLaserFlow.tsx");
  if (existsSync(port)) return;
  throw new Error(
    "The home page beam is missing. Clone nightly-labs/openbot-laser-flow into apps/auth-api/src/vendor/laser-flow.",
  );
}

function requiredSecret(name: string): string {
  const value = process.env[name];
  if (!value?.trim()) throw new Error(`${name} is missing from the decrypted production environment.`);
  if (value.startsWith("encrypted:"))
    throw new Error(`${name} is not decrypted. Check the environment decryption key.`);
  return value;
}

async function putRequiredSecret(name: string): Promise<void> {
  const value = requiredSecret(name);
  await run(wranglerExecutable, ["secret", "put", name, ...environmentArgs], {
    input: `${value}\n`,
    label: `${name} secret`,
  });
}

function assertFcmServiceAccount(): void {
  const value = process.env.FCM_SERVICE_ACCOUNT?.trim();
  if (!value) return;
  if (value.startsWith("encrypted:"))
    throw new Error("FCM_SERVICE_ACCOUNT is not decrypted. Check the environment decryption key.");
  if (!readFcmServiceAccount(value)) throw new Error("FCM_SERVICE_ACCOUNT is not a Firebase service account key file.");
}

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
  options: { env?: NodeJS.ProcessEnv | undefined; input?: string; label: string },
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
