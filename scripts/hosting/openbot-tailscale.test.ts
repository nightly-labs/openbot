import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

const command = resolve(import.meta.dirname, "openbot");
// `openbot tailscale setup` with root, the network and Tailscale replaced. The fake `tailscale` logs
// each call and answers `status --json` with the state in `$ROOT/state`. The fake install script
// installs it.
const harness = `
source "$OPENBOT"
INSTALL=$ROOT/opt
OS_RELEASE=$ROOT/osrelease
PATH=$ROOT/bin:/usr/bin:/bin
id() { if [ -e "$ROOT/not-root" ]; then echo 1000; else echo 0; fi; }
fetch() {
  echo "$*" >>"$ROOT/downloads"
  cp "$ROOT/install.sh" "$2"
}
tailscale_command "$@"
`;

const FAKE_TAILSCALE = `#!/bin/sh
echo "$*" >>"$ROOT/tailscale-calls"
case "$1" in
  status) printf '{\\n  "Version": "1.80.0",\\n  "BackendState": "%s",\\n  "AuthURL": ""\\n}\\n' "$(cat "$ROOT/state")" ;;
  up) echo Running >"$ROOT/state" ;;
esac
`;

let root: string;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "openbot-tailscale-"));
  mkdirSync(join(root, "bin"));
  mkdirSync(join(root, "opt", "hosted"), { recursive: true });
  writeFileSync(join(root, "opt", "hosted", "mode"), "self\n");
  writeFileSync(join(root, "opt", "hosted", "service-user"), "openbot\n");
  writeFileSync(join(root, "osrelease"), "6.8.0-45-generic\n");
  writeFileSync(join(root, "state"), "NeedsLogin");
  writeFileSync(join(root, "tailscale.sh"), FAKE_TAILSCALE);
  writeFileSync(
    join(root, "install.sh"),
    `cp "$ROOT/tailscale.sh" "$ROOT/bin/tailscale" && chmod +x "$ROOT/bin/tailscale" && echo installed >>"$ROOT/installs"\n`,
  );
});

afterEach(() => rmSync(root, { recursive: true, force: true }));

function installTailscale() {
  writeFileSync(join(root, "bin", "tailscale"), FAKE_TAILSCALE);
  chmodSync(join(root, "bin", "tailscale"), 0o755);
}

function run(...args: string[]) {
  return spawnSync("bash", ["-c", harness, "harness", ...args], {
    env: { HOME: root, ROOT: root, OPENBOT: command },
    encoding: "utf8",
  });
}

function read(name: string): string {
  const path = join(root, name);
  return existsSync(path) ? readFileSync(path, "utf8") : "";
}

describe("openbot tailscale setup", () => {
  it("installs Tailscale with the official script and signs in with the service user as operator", () => {
    const result = run("setup");
    expect(result.stderr).toBe("");
    expect(result.status).toBe(0);
    expect(read("downloads").trim()).toMatch(/ https:\/\/tailscale\.com\/install\.sh$/u);
    expect(read("installs").trim()).toBe("installed");
    expect(read("tailscale-calls").trim().split("\n")).toEqual([
      "status --json",
      "up --operator=openbot --timeout=10m",
    ]);
  });

  it("only sets the operator on a Tailscale that is already connected", () => {
    installTailscale();
    writeFileSync(join(root, "state"), "Running");
    const result = run("setup");
    expect(result.status).toBe(0);
    expect(read("downloads")).toBe("");
    expect(read("tailscale-calls").trim().split("\n")).toEqual(["status --json", "set --operator=openbot"]);
  });

  // The command never asks for an auth key and never publishes the server with Funnel.
  it("never passes an auth key or Funnel to Tailscale", () => {
    run("setup");
    expect(read("tailscale-calls")).not.toMatch(/auth-?key|funnel/iu);
  });

  it("refuses without root, and runs nothing", () => {
    writeFileSync(join(root, "not-root"), "");
    const result = run("setup");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("Run this with sudo: sudo openbot tailscale setup");
    expect(read("downloads")).toBe("");
    expect(read("tailscale-calls")).toBe("");
  });

  it("sends a server in WSL to the Windows app and mirrored networking", () => {
    writeFileSync(join(root, "osrelease"), "5.15.153.1-microsoft-standard-WSL2\n");
    const result = run("setup");
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("https://tailscale.com/download/windows");
    expect(result.stderr).toContain("networkingMode=mirrored");
    expect(read("downloads")).toBe("");
  });

  it("refuses a computer that is not a self-hosted server, and a container", () => {
    writeFileSync(join(root, "opt", "hosted", "mode"), "hosted\n");
    expect(run("setup").stderr).toContain("This computer is not a self-hosted OpenBot server.");
    writeFileSync(join(root, "opt", "hosted", "mode"), "container\n");
    expect(run("setup").stderr).toContain("In a container, install Tailscale on the computer that runs Docker.");
    expect(read("tailscale-calls")).toBe("");
  });

  it("refuses another subcommand or an extra argument", () => {
    expect(run("up").stderr).toContain("Usage: sudo openbot tailscale setup");
    expect(run("setup", "--authkey=tskey").stderr).toContain("Usage: sudo openbot tailscale setup");
    expect(read("tailscale-calls")).toBe("");
  });
});
