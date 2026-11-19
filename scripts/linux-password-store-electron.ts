import { writeFileSync } from "node:fs";
import { app, safeStorage } from "electron";
import { configureLinuxPasswordStore } from "../src/main/linux-password-store";

function argument(name: string): string {
  const value = process.argv.find((item) => item.startsWith(`--${name}=`));
  if (!value) throw new Error(`Missing --${name}=`);
  return value.slice(name.length + 3);
}

process.stdout.on("error", () => undefined);
process.stderr.on("error", () => undefined);
app.setPath("userData", argument("user-data"));
const configured = configureLinuxPasswordStore();
void app.whenReady().then(() => {
  writeFileSync(
    argument("ready-file"),
    JSON.stringify({
      configured,
      backend: safeStorage.getSelectedStorageBackend(),
      available: safeStorage.isEncryptionAvailable(),
    }),
  );
  app.quit();
});
