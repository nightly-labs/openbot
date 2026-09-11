import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const projectRoot = fileURLToPath(new URL("../apps/mobile", import.meta.url));

describe("mobile RocketSim integration", () => {
  it.skipIf(process.platform !== "darwin")("runs without RocketSim by default and enables it only on request", () => {
    const directory = mkdtempSync(join(tmpdir(), "openbot-mobile-ios-"));
    const launcher = fileURLToPath(new URL("./mobile-ios.ts", import.meta.url));
    const expo = createRequire(join(projectRoot, "package.json")).resolve("expo/bin/cli");
    const app = join(directory, "RocketSim.app");
    const framework = join(app, "Contents/Frameworks/RocketSimConnectLinker.nocache.framework");
    // Replace only the external commands. No prebuild, native build, or simulator runs in this test.
    const command = '#!/bin/sh\nprintf "%s\\n" "$OPENBOT_ROCKETSIM_FRAMEWORK" "$@"\n';
    writeFileSync(join(directory, "node"), command, { mode: 0o755 });
    writeFileSync(join(directory, "open"), command, { mode: 0o755 });
    const env = {
      ...process.env,
      PATH: `${directory}:${process.env.PATH}`,
      ROCKETSIM_APP_PATH: app,
      OPENBOT_ROCKETSIM: "1",
      OPENBOT_ROCKETSIM_FRAMEWORK: "stale-framework",
    };
    const prebuild = [expo, "prebuild", "--platform", "ios", "--no-clean", "--no-install"];
    try {
      const plain = execFileSync("bun", [launcher, "--port", "8099"], { env, encoding: "utf8" });
      expect(plain.split("\n")).toEqual(["", ...prebuild, "", expo, "run:ios", "--port", "8099", ""]);
      expect(() => execFileSync("bun", [launcher, "--rocketsim"], { env, stdio: "pipe" })).toThrow(
        "Use bun ios or bun mobile:ios to run without it.",
      );
      mkdirSync(framework, { recursive: true });
      const enabled = execFileSync("bun", [launcher, "--rocketsim", "--port", "8099"], { env, encoding: "utf8" });
      expect(enabled.split("\n")).toEqual([
        "",
        "-a",
        app,
        framework,
        ...prebuild,
        framework,
        expo,
        "run:ios",
        "--port",
        "8099",
        "",
      ]);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("generates an opt-in simulator Debug hook once and rejects an incompatible delegate", () => {
    const result = execFileSync(
      "node",
      [
        "-e",
        `
        const assert = require('node:assert/strict');
        const { addRocketSim } = require('./plugins/with-rocketsim');
        const delegate = 'class AppDelegate {\\n  func application() -> Bool {\\n    return true\\n  }\\n}';
        const path = '/Applications/RocketSim.app/Contents/Frameworks/RocketSimConnectLinker.nocache.framework';
        const generated = addRocketSim(delegate, path);
        assert.equal(addRocketSim(generated, path), generated);
        assert.match(generated, /#if DEBUG && targetEnvironment\\(simulator\\)/);
        assert.ok(generated.includes('Bundle(path: ' + JSON.stringify(path) + ')?.load()'));
        assert.equal(addRocketSim(generated, undefined), delegate);
        assert.ok(generated.indexOf('Bundle(path:') < generated.indexOf('return true'));
        assert.throws(() => addRocketSim('unsupported delegate', path));
        process.stdout.write('ok');
        `,
      ],
      { cwd: projectRoot, encoding: "utf8" },
    );
    expect(result).toBe("ok");
  });
});

describe("mobile OTA compatibility", () => {
  it.each(["ios", "android"] as const)(
    "requires a fingerprinted %s binary instead of the old 1.0.0 runtime",
    (platform) => {
      // Resolve Expo from the app's dependency tree, as the native config tooling does.
      const runtime = execFileSync(
        "node",
        [
          "-e",
          `
        const { getConfig } = require('expo/config');
        const { Updates } = require('expo/config-plugins');
        const { exp } = getConfig(process.cwd(), { skipSDKVersionRequirement: true });
        Updates.getRuntimeVersionAsync(process.cwd(), exp, process.argv[1])
          .then(runtime => process.stdout.write(runtime ?? ''));
      `,
          platform,
        ],
        { cwd: projectRoot, encoding: "utf8" },
      );
      expect(runtime).toBe("file:fingerprint");
    },
  );
});
