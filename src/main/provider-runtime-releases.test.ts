// @vitest-environment node

import { createHash } from "node:crypto";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { describe, expect, it } from "vitest";
import lockValue from "../../native-runtime.lock.json";
import { parseAgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import { latestRelease } from "./provider-runtime-releases";

const lock = parseAgentRuntimeLock(structuredClone(lockValue));
const tarball = new Uint8Array([1, 2, 3, 4]);
const sha512 = createHash("sha512").update(tarball).digest();

/** Answers the URLs in `routes`, and a first-byte request for any tarball with its size. */
function sources(routes: Record<string, DynamicRecord>) {
  return async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    if (new Headers(init?.headers).get("Range") === "bytes=0-0") {
      return new Response(tarball.slice(0, 1), {
        status: 206,
        headers: { "content-range": `bytes 0-0/${tarball.byteLength}` },
      });
    }
    return url in routes ? Response.json(routes[url]) : new Response(null, { status: 404 });
  };
}

describe("latestRelease", () => {
  it("reads the Codex release and the digest GitHub keeps for this computer's asset", async () => {
    const asset = lock.codex.artifacts["darwin-arm64"].asset;
    const fetch = sources({
      "https://api.github.com/repos/openai/codex/releases/latest": {
        tag_name: "rust-v0.160.0",
        assets: [{ name: asset, digest: `sha256:${"a".repeat(64)}`, size: 42 }],
      },
    });

    const spec = await latestRelease("codex", { target: "darwin-arm64", lock, fetch });

    expect(spec).toMatchObject({
      version: "0.160.0",
      source: "latest",
      url: `https://github.com/openai/codex/releases/download/rust-v0.160.0/${asset}`,
      archiveDigest: { algorithm: "sha256", hex: "a".repeat(64) },
      downloadBytes: 42,
    });
  });

  it("follows the Claude CLI version the latest SDK carries, and npm's sha512", async () => {
    const registry = "https://registry.npmjs.org";
    const platform = "@anthropic-ai/claude-agent-sdk-darwin-arm64";
    const url = `${registry}/${platform}/-/claude-agent-sdk-darwin-arm64-0.3.280.tgz`;
    const fetch = sources({
      [`${registry}/@anthropic-ai/claude-agent-sdk/latest`]: { version: "0.3.280", claudeCodeVersion: "2.1.280" },
      [`${registry}/${platform}/0.3.280`]: {
        version: "0.3.280",
        dist: { tarball: url, integrity: `sha512-${sha512.toString("base64")}` },
      },
    });

    const spec = await latestRelease("claude", { target: "darwin-arm64", lock, fetch });

    expect(spec).toMatchObject({
      version: "2.1.280",
      packageVersion: "0.3.280",
      url,
      archiveDigest: { algorithm: "sha512", hex: sha512.toString("hex") },
      downloadBytes: tarball.byteLength,
    });
  });

  it("refuses an npm release whose tarball is not on the registry the lock names", async () => {
    const registry = "https://registry.npmjs.org";
    const fetch = sources({
      [`${registry}/opencode-darwin-arm64/latest`]: {
        version: "1.19.0",
        dist: {
          tarball: "https://mirror.example/opencode-darwin-arm64-1.19.0.tgz",
          integrity: `sha512-${sha512.toString("base64")}`,
        },
      },
    });

    await expect(latestRelease("opencode", { target: "darwin-arm64", lock, fetch })).rejects.toThrow(
      "no verifiable download",
    );
  });

  it("takes a Gemini release only from Google's release path, with the pinned layout", async () => {
    const google = `${lock.antigravity.distribution}/macos/agy-acp-server-1.3.0-darwin-arm64.zip`;
    const registry = (archive: string, cmd = "./agy_acp_server.par") =>
      sources({
        [lock.antigravity.registry]: {
          version: "1.3.0",
          distribution: { binary: { "darwin-aarch64": { archive, cmd } } },
        },
      });

    await expect(
      latestRelease("antigravity", { target: "darwin-arm64", lock, fetch: registry(google) }),
    ).resolves.toMatchObject({ version: "1.3.0", url: google, archiveDigest: null, downloadBytes: tarball.byteLength });
    for (const fetch of [
      registry("https://mirror.example/agy-acp-server-1.3.0-darwin-arm64.zip"),
      registry(google, "./other_server"),
    ]) {
      await expect(latestRelease("antigravity", { target: "darwin-arm64", lock, fetch })).rejects.toThrow(
        "The Gemini release has an unexpected shape.",
      );
    }
  });
});
