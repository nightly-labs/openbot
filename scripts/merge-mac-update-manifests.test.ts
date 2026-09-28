import { describe, expect, it } from "vitest";
import { parse } from "yaml";
import { mergeMacUpdateManifests } from "./merge-mac-update-manifests";

function manifest(architecture: string, version = "0.24.0"): string {
  return `version: ${version}
files:
  - url: OpenBot-${version}-${architecture}.zip
    sha512: ${architecture}-zip
    size: 227966717
  - url: OpenBot-${version}-${architecture}.dmg
    sha512: ${architecture}-dmg
    size: 236364408
path: OpenBot-${version}-${architecture}.zip
sha512: ${architecture}-zip
releaseDate: '2026-09-27T17:22:20.710Z'
`;
}

describe("mergeMacUpdateManifests", () => {
  it("lists both architectures and keeps the ARM64 update as the default", () => {
    // YAML 1.1, as electron-updater's js-yaml reads it: an unquoted `releaseDate` would be a Date.
    expect(parse(mergeMacUpdateManifests(manifest("arm64"), manifest("x64")), { version: "1.1" })).toEqual({
      version: "0.24.0",
      files: [
        { url: "OpenBot-0.24.0-arm64.zip", sha512: "arm64-zip", size: 227966717 },
        { url: "OpenBot-0.24.0-arm64.dmg", sha512: "arm64-dmg", size: 236364408 },
        { url: "OpenBot-0.24.0-x64.zip", sha512: "x64-zip", size: 227966717 },
        { url: "OpenBot-0.24.0-x64.dmg", sha512: "x64-dmg", size: 236364408 },
      ],
      path: "OpenBot-0.24.0-arm64.zip",
      sha512: "arm64-zip",
      releaseDate: "2026-09-27T17:22:20.710Z",
    });
  });

  it("rejects manifests that would leave one architecture without an update", () => {
    expect(() => mergeMacUpdateManifests(manifest("x64"), manifest("x64"))).toThrow(
      "The ARM64 manifest lists OpenBot-0.24.0-x64.zip, which Apple silicon Macs skip.",
    );
    expect(() => mergeMacUpdateManifests(manifest("arm64"), manifest("arm64"))).toThrow(
      "The x64 manifest lists OpenBot-0.24.0-arm64.zip, which Intel Macs skip.",
    );
    expect(() => mergeMacUpdateManifests(manifest("arm64"), manifest("x64", "0.23.0"))).toThrow(
      "The macOS manifests name different versions: 0.24.0 and 0.23.0.",
    );
  });
});
