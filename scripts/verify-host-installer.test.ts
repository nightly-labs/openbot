import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { HOST_MANAGER_DIRECTORY } from "../src/main/host-update-files";
import { HOST_FILES, HOST_PACKAGE_ID, hostFileMode } from "./host-installation";
import { expectedHostPaths, verifyHostBom, verifyHostPayload } from "./verify-host-installer";

const exec = promisify(execFile);
function validBom(): string {
  return [...expectedHostPaths()]
    .map((path) => {
      const file = HOST_FILES.some((file) => `.${file}` === path);
      return `${path}\t${((file ? 0o100000 : 0o040000) | (file ? hostFileMode(path) : 0o755)).toString(8)}\t0\t0`;
    })
    .join("\n");
}

describe("host package manifest", () => {
  it("accepts only root-owned payload at the fixed destinations", () => {
    expect(() => verifyHostBom(validBom())).not.toThrow();
  });
  it.each([
    (text: string) => `${text}\n./node_modules/secret\t100644\t0\t0`,
    (text: string) => text.replace("100755", "100777"),
    (text: string) => text.replace("100755", "120755"),
    (text: string) => text.replace("\t0\t0", "\t501\t20"),
    (text: string) => text.split("\n").slice(1).join("\n"),
    (text: string) => `${text}\n./Users/client-acme/password.txt\t100600\t0\t0`,
  ])("rejects unexpected content, links, ownership or modes", (change) => {
    expect(() => verifyHostBom(change(validBom()))).toThrow();
  });
});

describe.skipIf(process.platform !== "darwin")("real macOS package expansion", () => {
  it("builds and expands a harmless unsigned fixture and rejects version/content changes", async () => {
    const temp = await mkdtemp(join(tmpdir(), "openbot-host-pkg-test-"));
    const payload = join(temp, "payload");
    const scripts = join(temp, "scripts");
    try {
      for (const path of HOST_FILES) {
        const target = join(payload, path);
        await mkdir(dirname(target), { recursive: true });
        let body = "fixture executable, never installed\n";
        const source = path.endsWith(".plist") || path.endsWith(".sh") || path === "/usr/local/bin/openbot-host";
        if (source) body = await readFile(`build/macos/host-updates/${path.split("/").at(-1)}`, "utf8");
        if (path.endsWith("host-release.json"))
          body = JSON.stringify({ version: "1.2.3", commit: "a".repeat(40), arch: "arm64" });
        await writeFile(target, body, { mode: hostFileMode(path) });
        await chmod(target, hostFileMode(path));
      }
      for (const path of expectedHostPaths())
        if (!HOST_FILES.some((file) => `.${file}` === path)) await chmod(join(payload, path), 0o755);
      await mkdir(scripts);
      for (const name of ["preinstall", "postinstall"]) {
        await copyFile(`build/macos/host-updates/${name}`, join(scripts, name));
        await chmod(join(scripts, name), 0o755);
      }
      const pkg = join(temp, "fixture.pkg");
      await exec("/usr/bin/pkgbuild", [
        "--root",
        payload,
        "--scripts",
        scripts,
        "--identifier",
        HOST_PACKAGE_ID,
        "--version",
        "1.2.3",
        "--install-location",
        "/",
        "--ownership",
        "recommended",
        pkg,
      ]);
      const expanded = join(temp, "expanded");
      await exec("/usr/sbin/pkgutil", ["--expand-full", pkg, expanded]);
      await verifyHostPayload(expanded, "1.2.3");
      await expect(verifyHostPayload(expanded, "1.2.4")).rejects.toThrow("version");
      await writeFile(join(expanded, "Payload", HOST_MANAGER_DIRECTORY, "secret.env"), "fixture");
      await expect(verifyHostPayload(expanded, "1.2.3")).rejects.toThrow("Unexpected");
    } finally {
      await rm(temp, { recursive: true, force: true });
    }
  });
});
