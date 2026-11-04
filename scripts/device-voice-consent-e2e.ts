// Exercises the desktop call controller with an enabled host and device/account consent.
// Only audio, analytics and transport boundaries are fixtures; routing and preferences are real.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { build } from "bun";

const output = resolve(".openbot-build/device-voice-consent-e2e");
await mkdir(output, { recursive: true });
const native = resolve("scripts/fixtures/mobile-voice/desktop-consent-native.js");
await build({
  entrypoints: ["scripts/fixtures/mobile-voice/desktop-consent-driver.js"],
  outdir: output,
  naming: "driver.mjs",
  target: "bun",
  packages: "external",
  plugins: [
    {
      name: "desktop-audio-boundaries",
      setup(b) {
        b.onResolve(
          {
            filter:
              /(^@openbot\/ui$|^@openbot\/ui\/text$|^@openbot\/ui\/components\/SkillPreview$|\/analytics$|\/speech-playback$|\/speech-port$|\/speech-replies$|\/realtime-voice-conversation$)/,
          },
          () => ({ path: native }),
        );
      },
    },
  ],
});
const result = JSON.parse(
  execFileSync(process.execPath, ["--conditions=browser", `${output}/driver.mjs`], { encoding: "utf8" }),
);
assert.equal(result.passed, true);
await writeFile(`${output}/report.json`, `${JSON.stringify(result, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(result)}\n`);

const settingsNative = resolve("scripts/fixtures/mobile-voice/settings-native.js");
await build({
  entrypoints: ["scripts/fixtures/mobile-voice/settings-driver.js"],
  outdir: output,
  naming: "settings.mjs",
  target: "bun",
  packages: "external",
  plugins: [
    {
      name: "phone-keychain-boundary",
      setup(b) {
        b.onResolve({ filter: /^expo-secure-store$/ }, () => ({ path: settingsNative }));
      },
    },
  ],
});
const settings = JSON.parse(execFileSync(process.execPath, [`${output}/settings.mjs`], { encoding: "utf8" }));
assert.equal(settings.passed, true);
await writeFile(`${output}/settings-report.json`, `${JSON.stringify(settings, null, 2)}\n`);
process.stdout.write(`${JSON.stringify(settings)}\n`);
