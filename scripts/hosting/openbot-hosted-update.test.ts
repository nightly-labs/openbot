import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const updater = resolve(import.meta.dirname, "openbot-hosted-update");
// The real functions, with the network, apt, root and systemd replaced. `fetch` serves `web/`.
const harness = `
source "$UPDATER"
INSTALL=$ROOT/opt
SCRATCH=$ROOT/tmp
REQUESTS=$ROOT/run
STATE=$ROOT/state
systemctl() { echo "systemctl $*" >>"$ROOT/calls"; }
uname() { echo x86_64; }
chown() { :; }
fetch() {
  if [ "$1" = --output ]; then
    cp "$ROOT/web/\${3##*/}" "$2"
    echo "\${3##*/}" >>"$ROOT/downloads"
  else
    cat "$ROOT/web/\${1##*/}"
  fi
}
install_packages() { echo "$1" >>"$ROOT/packages"; }
install_hosting() {
  if [ -e "$ROOT/fail-hosting" ]; then return 1; fi
  echo "$1" >>"$ROOT/hosting"
}
"$@"
`;

const HOSTING_FILES = [
  "openbot-hosted.apparmor",
  "openbot-hosted-server",
  "openbot-hosted-env",
  "openbot-hosted-update",
  "openbot",
  "openbot.service",
  "openbot-update.service",
  "openbot-update.timer",
  "openbot-update-apply.service",
  "openbot-update-request.path",
  "openbot-update-request.service",
].join(" ");

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openbot-hosted-update-"));
  mkdirSync(join(root, "web"));
  mkdirSync(join(root, "opt"));
  mkdirSync(join(root, "tmp"));
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function run(command: "stage" | "apply" | "request") {
  return spawnSync("bash", ["-c", harness, "harness", command], {
    env: { ...process.env, ROOT: root, UPDATER: updater },
    encoding: "utf8",
  });
}

function installRelease(directory: string, version: string) {
  const path = join(root, "opt", directory);
  mkdirSync(path, { recursive: true });
  writeFileSync(join(path, "openbot.desktop"), `[Desktop Entry]\nX-AppImage-Version=${version}\n`);
  writeFileSync(join(path, "openbot"), "#!/bin/sh\n", { mode: 0o755 });
}

/** A complete staged release, as `stage` leaves it. */
function stageRelease(version: string) {
  installRelease("staged", version);
  writeFileSync(join(root, "opt", "staged.ready"), `${version}\n`);
}

/** Publishes a release as the latest one. An AppImage here is a script that unpacks a release. */
function publish(version: string, options: { hosting?: boolean; manifestFor?: string } = {}) {
  const hosting = options.hosting ?? true;
  const appImage = [
    "#!/bin/bash",
    '[ "$1" = --appimage-extract ] || exit 1',
    "mkdir -p squashfs-root/resources",
    `printf '[Desktop Entry]\\nX-AppImage-Version=${version}\\n' >squashfs-root/openbot.desktop`,
    "printf '#!/bin/sh\\n' >squashfs-root/openbot && chmod 0755 squashfs-root/openbot",
    ": >squashfs-root/chrome-sandbox",
    hosting ? "mkdir squashfs-root/resources/hosting && echo curl >squashfs-root/resources/hosting/packages.txt" : "",
    hosting ? `(cd squashfs-root/resources/hosting && touch ${HOSTING_FILES})` : "",
    "",
  ].join("\n");
  const name = `OpenBot-${version}-x86_64.AppImage`;
  writeFileSync(join(root, "web", name), appImage);
  const sha512 = createHash("sha512")
    .update(options.manifestFor ?? appImage)
    .digest("base64");
  writeFileSync(
    join(root, "web", "latest-linux.yml"),
    `version: ${version}\nfiles:\n  - url: ${name}\n    sha512: ${sha512}\npath: ${name}\nsha512: ${sha512}\n`,
  );
}

function versionOf(directory: string): string | null {
  const entry = join(root, "opt", directory, "openbot.desktop");
  if (!existsSync(entry)) return null;
  return /X-AppImage-Version=(.+)/.exec(readFileSync(entry, "utf8"))?.[1] ?? null;
}

/** The installed script that `request` runs. It records each run, and fails a step when told to. */
function installUpdater() {
  mkdirSync(join(root, "opt", "hosted"), { recursive: true });
  writeFileSync(
    join(root, "opt", "hosted", "openbot-hosted-update"),
    `#!/bin/bash\necho "update $1" >>"$ROOT/calls"\n[ ! -e "$ROOT/fail-$1" ]\n`,
    { mode: 0o755 },
  );
}

function log(name: string): string {
  const path = join(root, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("openbot-hosted-update", () => {
  it("stages a newer release while OpenBot runs and moves it into place at the next start", () => {
    installRelease("app", "0.25.2");
    publish("0.25.3");

    expect(run("stage").status).toBe(0);
    expect(versionOf("app")).toBe("0.25.2");
    expect(versionOf("staged")).toBe("0.25.3");
    expect(log("packages")).toContain("resources/hosting/packages.txt");

    expect(run("apply").status).toBe(0);
    expect(versionOf("app")).toBe("0.25.3");
    expect(versionOf("staged")).toBeNull();
    expect(log("hosting").trim()).toBe(join(root, "opt", "app", "resources", "hosting"));
  });

  it("never moves a server to an older release", () => {
    installRelease("app", "0.25.3");
    publish("0.25.2");
    expect(run("stage").status).toBe(0);
    expect(log("downloads")).toBe("");
    expect(versionOf("staged")).toBeNull();

    stageRelease("0.25.2");
    expect(run("apply").status).toBe(0);
    expect(versionOf("app")).toBe("0.25.3");
    expect(readdirSync(join(root, "opt"))).toEqual(["app"]);
  });

  it("refuses an AppImage that does not match the manifest and keeps no partial download", () => {
    installRelease("app", "0.25.2");
    publish("0.25.3", { manifestFor: "another file" });
    const result = run("stage");
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("The AppImage does not match the release manifest.");
    expect(readdirSync(join(root, "opt"))).toEqual(["app"]);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);

    publish("0.25.3", { hosting: false });
    expect(run("stage").stderr).toContain("The release has no hosting files.");
    expect(readdirSync(join(root, "opt"))).toEqual(["app"]);
    expect(readdirSync(join(root, "tmp"))).toEqual([]);
  });

  it("drops a staged release that is no longer the latest one", () => {
    installRelease("app", "0.25.2");
    publish("0.25.4");
    expect(run("stage").status).toBe(0);
    publish("0.25.3");
    expect(run("stage").status).toBe(0);
    expect(versionOf("staged")).toBe("0.25.3");
  });

  it("keeps a copy that a stop interrupted until stage makes it again", () => {
    installRelease("app", "0.25.2");
    installRelease("staged", "0.25.3");
    expect(run("apply").status).toBe(0);
    expect(versionOf("app")).toBe("0.25.2");

    publish("0.25.3");
    expect(run("stage").status).toBe(0);
    expect(log("downloads").trim()).toBe("OpenBot-0.25.3-x86_64.AppImage");
    expect(run("apply").status).toBe(0);
    expect(versionOf("app")).toBe("0.25.3");
  });

  it("copies the release again after a stop or a failure during the move into place", () => {
    stageRelease("0.25.3");
    installRelease("app", "0.25.3");
    rmSync(join(root, "opt", "app", "openbot"));
    writeFileSync(join(root, "opt", ".applying"), "");
    // A check keeps the only complete copy, also when the latest release is another one.
    publish("0.25.4");
    expect(run("stage").status).toBe(0);
    expect(versionOf("staged")).toBe("0.25.3");

    writeFileSync(join(root, "fail-hosting"), "");
    expect(run("apply").status).not.toBe(0);
    expect(existsSync(join(root, "opt", ".applying"))).toBe(true);
    rmSync(join(root, "fail-hosting"));
    expect(run("apply").status).toBe(0);
    expect(existsSync(join(root, "opt", "app", "openbot"))).toBe(true);
    expect(readdirSync(join(root, "opt"))).toEqual(["app"]);
  });

  it("takes an install request without reading it, then stages, stops OpenBot, applies and starts it again", () => {
    installUpdater();
    // With no network, the release that is already staged still applies.
    writeFileSync(join(root, "fail-stage"), "");
    // The service user owns the request directory, so a request can be a link to a file of root.
    mkdirSync(join(root, "run"));
    writeFileSync(join(root, "secret"), "root only\n");
    symlinkSync(join(root, "secret"), join(root, "run", "update-install"));
    writeFileSync(join(root, "run", "update-stage"), "");

    expect(run("request").status).toBe(0);
    expect(log("calls").trim().split("\n")).toEqual([
      "update stage",
      "systemctl stop openbot.service",
      "update apply",
      "systemctl start --no-block openbot.service",
    ]);
    expect(readdirSync(join(root, "run"))).toEqual([]);
    expect(readFileSync(join(root, "secret"), "utf8")).toBe("root only\n");
    expect(existsSync(join(root, "state"))).toBe(false);
  });

  it("starts OpenBot again when the update fails, also when the copy cannot complete", () => {
    installUpdater();
    mkdirSync(join(root, "run"));
    writeFileSync(join(root, "run", "update-install"), "");
    writeFileSync(join(root, "fail-apply"), "");
    // The failed copy left `.applying`, so the start tries `apply` again, and that fails too.
    writeFileSync(join(root, "opt", ".applying"), "");

    expect(run("request").status).not.toBe(0);
    expect(log("calls").trim().split("\n").slice(-2)).toEqual([
      "update apply",
      "systemctl start --no-block openbot.service",
    ]);
  });
});
