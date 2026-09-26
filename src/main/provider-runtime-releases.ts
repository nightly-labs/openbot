import { MANAGED_RUNTIME_PROVIDERS, type ManagedProviderId } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  codexTag,
  providerRuntimeDescriptor,
  type RuntimeSpec,
  type RuntimeTarget,
} from "./provider-runtime-descriptors";

/**
 * The latest release of each provider CLI, read from the source that publishes it.
 *
 * OpenBot used to install only the version `native-runtime.lock.json` pinned, so a new CLI reached
 * users with the next OpenBot release. Providers ship faster than that, so the update offer now
 * follows upstream. The lock still names the version a first install uses when no source answers.
 *
 * Every download keeps a hash from its source: GitHub's asset `digest` for Codex and npm's
 * `dist.integrity` for Claude and OpenCode. x.ai publishes no hash for Grok, so a Grok release is
 * trusted on TLS alone. Bun is a tool runtime rather than a provider, and stays on the lock.
 */

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LatestReleaseContext {
  target: RuntimeTarget;
  lock: AgentRuntimeLock;
  fetch: Fetch;
}

/**
 * Versions the OpenBot repository asks every installation not to offer.
 *
 * This is the one way to stop a broken upstream release without shipping an OpenBot release. It is a
 * block list, not an allow list: a new release is offered at once, and only a version named here is
 * held back. A list that cannot be read blocks nothing.
 */
const BLOCKED_VERSIONS_URL =
  "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/u;
const HEADERS = { "User-Agent": "OpenBot-runtime-installer" };

export type BlockedVersions = ReadonlyMap<ManagedProviderId, ReadonlySet<string>>;

/** The ACP registry's name for each target. */
const ACP_REGISTRY_TARGETS: Record<RuntimeTarget, string> = {
  "darwin-arm64": "darwin-aarch64",
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-aarch64",
  "win32-x64": "windows-x86_64",
};

const LATEST_RELEASES: Record<ManagedProviderId, (context: LatestReleaseContext) => Promise<RuntimeSpec>> = {
  codex: async ({ target, lock, fetch }) => {
    const pinned = providerRuntimeDescriptor("codex").spec(target, lock);
    const api = lock.codex.repository.replace("https://github.com/", "https://api.github.com/repos/");
    const release = await fetchJson(fetch, `${api}/releases/latest`, { Accept: "application/vnd.github+json" });
    const version = isString(release.tag_name) ? versionFromTag(release.tag_name) : null;
    if (!(version && Array.isArray(release.assets))) {
      throw new Error(sourceText("error.provider.codexReleaseShape"));
    }
    const name = lock.codex.artifacts[target].asset;
    const asset = release.assets.find((entry: unknown) => isDynamicRecord(entry) && entry.name === name);
    const sha256 =
      isDynamicRecord(asset) && isString(asset.digest) ? /^sha256:([0-9a-f]{64})$/u.exec(asset.digest)?.[1] : null;
    if (!(sha256 && isDynamicRecord(asset) && isNumber(asset.size) && asset.size > 0)) {
      throw new Error(sourceText("error.provider.codexReleaseNoDownload"));
    }
    return {
      ...pinned,
      version,
      packageVersion: version,
      source: "latest",
      url: `${lock.codex.repository}/releases/download/${encodeURIComponent(codexTag(version))}/${name}`,
      archiveDigest: { algorithm: "sha256", hex: sha256 },
      downloadBytes: asset.size,
    };
  },
  claude: async ({ target, lock, fetch }) => {
    const pinned = providerRuntimeDescriptor("claude").spec(target, lock);
    // The SDK's own package names the CLI version its platform packages carry.
    const sdk = await fetchJson(fetch, `${lock.claude.registry}/@anthropic-ai/claude-agent-sdk/latest`);
    const sdkVersion = isString(sdk.version) ? sdk.version : null;
    const cliVersion = isString(sdk.claudeCodeVersion) ? sdk.claudeCodeVersion : null;
    if (!(sdkVersion && cliVersion && VERSION.test(sdkVersion) && VERSION.test(cliVersion))) {
      throw new Error(sourceText("error.provider.claudeReleaseShape"));
    }
    const artifact = await npmArtifact(fetch, lock.claude.registry, lock.claude.artifacts[target].package, sdkVersion);
    return { ...pinned, ...artifact, version: cliVersion, packageVersion: sdkVersion, source: "latest" };
  },
  opencode: async ({ target, lock, fetch }) => {
    const pinned = providerRuntimeDescriptor("opencode").spec(target, lock);
    const artifact = await npmArtifact(
      fetch,
      lock.opencode.registry,
      lock.opencode.artifacts[target].package,
      "latest",
    );
    return { ...pinned, ...artifact, version: artifact.packageVersion, source: "latest" };
  },
  grok: async ({ target, lock, fetch }) => {
    const pinned = providerRuntimeDescriptor("grok").spec(target, lock);
    const response = await request(fetch, `${lock.grok.distribution}/stable`);
    const version = (await readText(response)).trim();
    if (!VERSION.test(version)) throw new Error(sourceText("error.provider.grokReleaseVersion"));
    const asset = lock.grok.artifacts[target].asset.replace(`grok-${lock.grok.version}-`, `grok-${version}-`);
    const url = `${lock.grok.distribution}/${asset}`;
    return {
      ...pinned,
      version,
      packageVersion: version,
      source: "latest",
      url,
      archiveDigest: null,
      downloadBytes: await downloadSize(fetch, url),
    };
  },
  /**
   * Google publishes the server in the ACP registry, with no hash, so the latest release is trusted
   * on TLS alone, like Grok's. The download must stay on Google's release path and keep the layout
   * the pinned version has: a changed command means a changed archive, which staging would refuse.
   */
  antigravity: async ({ target, lock, fetch }) => {
    const pinned = providerRuntimeDescriptor("antigravity").spec(target, lock);
    const agent = await fetchJson(fetch, lock.antigravity.registry);
    const version = isString(agent.version) ? agent.version : null;
    const binary = isDynamicRecord(agent.distribution) ? agent.distribution.binary : null;
    const entry = isDynamicRecord(binary) ? binary[ACP_REGISTRY_TARGETS[target]] : null;
    const artifact = lock.antigravity.artifacts[target];
    const url = isDynamicRecord(entry) && isString(entry.archive) ? entry.archive : null;
    const expectedUrl = version
      ? `${lock.antigravity.distribution}/${artifact.platformDirectory}/${artifact.asset.replace(
          `-${lock.antigravity.version}-`,
          `-${version}-`,
        )}`
      : null;
    if (
      !(version && VERSION.test(version) && url !== null && url === expectedUrl) ||
      !isDynamicRecord(entry) ||
      entry.cmd !== `./${artifact.executable}`
    ) {
      throw new Error(sourceText("error.provider.antigravityReleaseShape"));
    }
    return {
      ...pinned,
      version,
      packageVersion: version,
      source: "latest",
      url,
      archiveDigest: null,
      downloadBytes: await downloadSize(fetch, url),
    };
  },
};

export function latestRelease(provider: ManagedProviderId, context: LatestReleaseContext): Promise<RuntimeSpec> {
  return LATEST_RELEASES[provider](context);
}

/** Reads the block list. Rejects when it cannot be read, so the caller keeps the last one it had. */
export async function fetchBlockedVersions(fetch: Fetch): Promise<BlockedVersions> {
  const value = await fetchJson(fetch, BLOCKED_VERSIONS_URL);
  if (!(value.schemaVersion === 1 && isDynamicRecord(value.blocked))) {
    throw new Error(sourceText("error.provider.blockedListShape"));
  }
  const blocked = new Map<ManagedProviderId, ReadonlySet<string>>();
  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const versions = value.blocked[provider];
    if (Array.isArray(versions)) blocked.set(provider, new Set(versions.filter(isString)));
  }
  return blocked;
}

/** The parts of a spec one npm platform package decides. */
async function npmArtifact(
  fetch: Fetch,
  registry: string,
  packageName: string,
  version: string,
): Promise<Pick<RuntimeSpec, "packageVersion" | "url" | "archiveDigest" | "downloadBytes">> {
  const manifest = await fetchJson(fetch, `${registry}/${packageName}/${version}`);
  const dist = manifest.dist;
  const packageVersion = isString(manifest.version) ? manifest.version : null;
  const tarball = isDynamicRecord(dist) && isString(dist.tarball) ? dist.tarball : null;
  const integrity = isDynamicRecord(dist) && isString(dist.integrity) ? sha512Hex(dist.integrity) : null;
  // The download stays on the registry the lock names, whatever the manifest points at.
  if (
    !(packageVersion && VERSION.test(packageVersion) && tarball?.startsWith(`${registry}/${packageName}/-/`)) ||
    !integrity
  ) {
    throw new Error(sourceText("error.provider.releaseNoDownload", { name: packageName }));
  }
  return {
    packageVersion,
    url: tarball,
    archiveDigest: { algorithm: "sha512", hex: integrity },
    downloadBytes: await downloadSize(fetch, tarball),
  };
}

/** npm writes `sha512-<base64>`; the manager compares hex. */
function sha512Hex(integrity: string): string | null {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/u.exec(integrity);
  return match?.[1] ? Buffer.from(match[1], "base64").toString("hex") : null;
}

function versionFromTag(tag: string): string | null {
  const version = /^rust-v(\d+\.\d+\.\d+)$/u.exec(tag)?.[1];
  return version ?? null;
}

/**
 * The size of a download, from a request for its first byte.
 *
 * The npm registry answers `HEAD` without a length, and the manager needs one before it starts: the
 * free-space check, the progress and the final size check all depend on it.
 */
async function downloadSize(fetch: Fetch, url: string): Promise<number> {
  const response = await fetch(url, {
    headers: { ...HEADERS, Range: "bytes=0-0" },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  await response.body?.cancel().catch(() => undefined);
  const total =
    response.status === 206
      ? Number(/\/(\d+)$/u.exec(response.headers.get("content-range") ?? "")?.[1])
      : Number(response.headers.get("content-length"));
  if (!(response.ok && Number.isSafeInteger(total) && total > 0)) {
    throw new Error(sourceText("error.provider.releaseSizeUnknown"));
  }
  return total;
}

/** Every source answers with a JSON object; anything else is a failed check, not a value. */
async function fetchJson(fetch: Fetch, url: string, headers: Record<string, string> = {}): Promise<DynamicRecord> {
  const value = JSON.parse(await readText(await request(fetch, url, headers)));
  if (!isDynamicRecord(value)) throw new Error(sourceText("error.provider.releaseMetadataNotObject"));
  return value;
}

async function request(fetch: Fetch, url: string, headers: Record<string, string> = {}): Promise<Response> {
  const response = await fetch(url, {
    headers: { ...HEADERS, ...headers },
    redirect: "follow",
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(sourceText("error.provider.releaseCheckHttp", { status: response.status }));
  }
  return response;
}

async function readText(response: Response): Promise<string> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_METADATA_BYTES) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(sourceText("error.provider.releaseMetadataTooLarge"));
  }
  const text = await response.text();
  if (text.length > MAX_METADATA_BYTES) throw new Error(sourceText("error.provider.releaseMetadataTooLarge"));
  return text;
}
