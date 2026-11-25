import { readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { set } from "@dotenvx/dotenvx";
import { createOpenBotLogger } from "@openbot/logging";
import { setDevelopmentOverrides } from "./development-secrets";

const logger = createOpenBotLogger("dev-apns-key");

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
    setDevelopmentOverrides(projectRoot, {
      APNS_PRIVATE_KEY: privateKey.trim().replaceAll("\n", "\\n"),
      APNS_KEY_ID: keyId,
    });
    logger.info(`Saved the APNs key ${keyId} in local development state. Restart bun run dev to use it.`);
  }
}
