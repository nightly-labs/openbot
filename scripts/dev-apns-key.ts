import { chmodSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { set } from "@dotenvx/dotenvx";
import { createOpenBotLogger } from "@openbot/logging";
import { ensureDevelopmentEnvFile } from "./development-secrets";

// Puts an Apple Push Notification service key into this checkout's `apps/auth-api/.env.dev`, so
// the local Auth API can send iPhone Live Activity updates. The env file is not committed. The key
// text never goes to the output.
//
//   bun run dev:apns-key -- ~/Downloads/AuthKey_ABC1234567.p8 [KEY_ID]
//   bun run dev:apns-key -- ~/Downloads/AuthKey_ABC1234567.p8 --production
//
// The key ID comes from the file name that Apple gives the download, or from the second argument.
// `--production` encrypts both values into `apps/auth-api/.env.production` with the dotenvx key in
// `.env.keys`, which `bun run api:deploy` reads. The key is one line there, with `\n` for each line
// break, and the Worker turns them back into line breaks.

const logger = createOpenBotLogger("dev-apns-key");

export function withApnsKey(environment: string, privateKey: string, keyId: string): string {
  const kept = environment
    .split("\n")
    .filter((line) => !line.startsWith("APNS_PRIVATE_KEY=") && !line.startsWith("APNS_KEY_ID="))
    .join("\n")
    .trimEnd();
  const escaped = privateKey.trim().replaceAll("\n", "\\n");
  return `${kept}\n\n# Apple Push Notification service key for Live Activity updates. Local only.\nAPNS_PRIVATE_KEY="${escaped}"\nAPNS_KEY_ID=${keyId}\n`;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const production = args.includes("--production");
  const [path, keyIdArgument] = args.filter((argument) => argument !== "--production");
  if (!path) throw new Error("Give the path of the .p8 key: bun run dev:apns-key -- <AuthKey_ID.p8> [KEY_ID]");
  const keyId = keyIdArgument ?? /^AuthKey_([A-Z0-9]{10})\.p8$/u.exec(basename(path))?.[1];
  if (!keyId || !/^[A-Z0-9]{10}$/u.test(keyId)) throw new Error("Give the 10-character key ID as the second argument.");
  const privateKey = readFileSync(path, "utf8");
  if (!privateKey.includes("-----BEGIN PRIVATE KEY-----")) throw new Error("The file is not an Apple .p8 key.");
  const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
  if (production) {
    const options = {
      path: join(projectRoot, "apps", "auth-api", ".env.production"),
      envKeysFile: join(projectRoot, ".env.keys"),
    };
    for (const [name, value] of [
      ["APNS_PRIVATE_KEY", privateKey.trim().replaceAll("\n", "\\n")],
      ["APNS_KEY_ID", keyId],
    ] as const) {
      const error = (await set(name, value, options)).processedEnvs.find((entry) => entry.error)?.error;
      if (error) throw new Error(`Could not encrypt ${name}: ${error.message}`);
    }
    logger.info(`Encrypted the APNs key ${keyId} into apps/auth-api/.env.production.`);
  } else {
    ensureDevelopmentEnvFile(projectRoot);
    const envPath = join(projectRoot, "apps", "auth-api", ".env.dev");
    writeFileSync(envPath, withApnsKey(readFileSync(envPath, "utf8"), privateKey, keyId), "utf8");
    chmodSync(envPath, 0o600);
    logger.info(`Saved the APNs key ${keyId} in apps/auth-api/.env.dev. Restart bun run dev to use it.`);
  }
}
