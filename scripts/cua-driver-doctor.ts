// Read-only: where the Computer Use driver is on this computer, and what it says about itself.
//
// Separate from `codex-doctor.ts` because the driver is no longer a Codex plugin. It answers the
// one question the app cannot answer for the developer: whether the binary the app would pick is
// the binary they think they installed.

import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { promisify } from "node:util";
import { CUA_DRIVER_VENDOR_CALLS_OFF, resolveCuaDriver } from "../src/main/cua-driver-artifact";

const run = promisify(execFile);

const executable = await resolveCuaDriver({
  isPackaged: false,
  resourcesPath: "",
  sourceRoot: resolve(import.meta.dirname, ".."),
  platform: process.platform,
  architecture: process.arch,
  homeDirectory: homedir(),
  pathVariable: process.env.PATH ?? null,
  overrides: [process.env.OPENBOT_CUA_DRIVER_PATH, process.env.CUA_DRIVER_PATH],
  installDirectory: process.env.CUA_DRIVER_RS_INSTALL_DIR ?? process.env.CUA_DRIVER_BIN_DIR,
  localAppDataDirectory: process.env.LOCALAPPDATA,
  applicationsDirectory: "/Applications",
});

if (!executable) {
  // Machine-readable: doctor result JSON consumed by tooling.
  process.stderr.write(
    `${JSON.stringify(
      {
        ok: false,
        error: "No Computer Use driver on this computer. Install it, or point OPENBOT_CUA_DRIVER_PATH at a build.",
      },
      null,
      2,
    )}\n`,
  );
  process.exitCode = 1;
} else {
  try {
    const { stdout, stderr } = await run(executable, ["doctor"], {
      timeout: 20_000,
      env: { ...process.env, ...CUA_DRIVER_VENDOR_CALLS_OFF },
    });
    // Machine-readable: doctor result JSON consumed by tooling.
    process.stdout.write(
      `${JSON.stringify({ ok: true, executable, doctor: stdout.trim() || stderr.trim() }, null, 2)}\n`,
    );
  } catch (error) {
    // Machine-readable: doctor failure JSON consumed by tooling.
    process.stderr.write(
      `${JSON.stringify(
        { ok: false, executable, error: error instanceof Error ? error.message : String(error) },
        null,
        2,
      )}\n`,
    );
    process.exitCode = 1;
  }
}
