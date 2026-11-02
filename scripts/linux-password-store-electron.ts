// Electron side of `scripts/linux-password-store-e2e.ts`. It selects the password store as
// `src/main/index.ts` does, then writes the `safeStorage` backend to `--ready-file` and quits.
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
// No top-level await: Electron does not get ready until an ESM main module has run to its end.
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
