import { execFile } from "node:child_process";
import { chmod, copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { HOST_MANAGER_DIRECTORY } from "../src/main/host-update-files";
import { HOST_FILES, HOST_PACKAGE_ID, hostFileMode } from "./host-installation";
import { expectedHostPaths, verifyHostBom, verifyHostPayload, verifyHostSignature } from "./verify-host-installer";

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

// Captured from `pkgutil --check-signature` on a package signed by the real Developer ID Installer
// identity. The wording is Apple's, so it is reproduced exactly rather than paraphrased.
const signedByDeveloperId = `Package "probe.pkg":
   Status: signed by a developer certificate issued by Apple for distribution
   Signed with a trusted timestamp on: 2026-09-21 09:07:44 +0000
   Certificate Chain:
    1. Developer ID Installer: Akudama GmbH (ZTRDTUL87R)
       Expires: 2031-09-17 00:00:00 +0000
       SHA256 Fingerprint:
           3E B7 39 0D 0F 82 32 B2 06 FC 16 17 9D BB D9 A3 A6 2F 54 07 70 11 
           79 D4 89 63 30 9A 1C BD AF 41
       ------------------------------------------------------------------------
    2. Developer ID Certification Authority
       Expires: 2031-09-17 00:00:00 +0000
       ------------------------------------------------------------------------
    3. Apple Root CA
       Expires: 2035-02-09 21:40:36 +0000
`;

describe("host package signature", () => {
  it("accepts the status a Developer ID Installer package really reports", () => {
    expect(() => verifyHostSignature(signedByDeveloperId)).not.toThrow();
  });

  it("reports what the package said, so a wrong status does not have to be guessed at", () => {
    expect(() => verifyHostSignature('Package "probe.pkg":\n   Status: no signature\n')).toThrow(
      "Status: no signature",
    );
  });

  it.each([
    [
      "an App Store installer certificate, which cannot install this package",
      signedByDeveloperId
        .replace(
          "signed by a developer certificate issued by Apple for distribution",
          "signed by a certificate trusted by macOS",
        )
        .replace("Developer ID Installer:", "3rd Party Mac Developer Installer:"),
    ],
    ["another team", signedByDeveloperId.replace("ZTRDTUL87R", "A1B2C3D4E5")],
    ["no signature at all", 'Package "probe.pkg":\n   Status: no signature\n'],
    [
      "a signature with no trusted timestamp",
      signedByDeveloperId.replace(/ *Signed with a trusted timestamp on: .*\n/, ""),
    ],
    [
      "a status that only appears inside another line",
      signedByDeveloperId.replace(
        /^ *Status: .*$/m,
        "   Note: not signed by a developer certificate issued by Apple for distribution",
      ),
    ],
  ])("rejects %s", (_case, signature) => {
    expect(() => verifyHostSignature(signature)).toThrow("Unexpected installer signing identity");
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
