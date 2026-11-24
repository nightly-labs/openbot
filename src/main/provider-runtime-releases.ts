import { MANAGED_RUNTIME_PROVIDERS, type ManagedProviderId } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  codexTag,
  cursorPackageUrl,
  kimiAssetName,
  OPENCODE_CLI_PACKAGE,
  providerRuntimeDescriptor,
  type RuntimeSpec,
  type RuntimeTarget,
} from "./provider-runtime-descriptors";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";

type Fetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface LatestReleaseContext {
  target: RuntimeTarget;
  lock: AgentRuntimeLock;
  fetch: Fetch;
}

const BLOCKED_VERSIONS_URL =
  "https://raw.githubusercontent.com/nightly-labs/openbot/main/provider-runtime-blocklist.json";

const REQUEST_TIMEOUT_MS = 30_000;
const MAX_METADATA_BYTES = 4 * 1024 * 1024;
const VERSION = /^\d+\.\d+\.\d+$/u;
const CURSOR_DATE = /^\d{4}\.\d{2}\.\d{2}$/u;
const CURSOR_BUILD = /^\d{4}\.\d{2}\.\d{2}(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40}$/u;
const HEADERS = { "User-Agent": "OpenBot-runtime-installer" };

export type BlockedVersions = ReadonlyMap<ManagedProviderId, ReadonlySet<string>>;

const ACP_REGISTRY_TARGETS: Record<RuntimeTarget, string> = {
  "darwin-arm64": "darwin-aarch64",
  "darwin-x64": "darwin-x86_64",
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-aarch64",
  "win32-x64": "windows-x86_64",
};

const ANTIGRAVITY_TARGETS: Record<RuntimeTarget, string> = {
  "darwin-arm64": "mac_arm64",
  "darwin-x64": "mac_x64",
  "linux-x64": "linux_x64",
  "linux-arm64": "linux_arm64",
  "win32-x64": "windows_x64",
};

const latestGitHubAsset = Effect.fn("ProviderRelease.github")(function* (
  fetch: Fetch,
  repo: string,
  assetNameOf: (version: string) => string,
  pinned: RuntimeSpec,
  tagPrefix: "v" | "" = "v",
) {
  const release = yield* fetchJsonEffect(fetch, `https://api.github.com/repos/${repo}/releases/latest`, {
    Accept: "application/vnd.github+json",
  });
  const version = isString(release.tag_name) ? versionFromTag(release.tag_name, tagPrefix) : null;
  const assetName = version ? assetNameOf(version) : null;
  const asset = Array.isArray(release.assets)
    ? release.assets.find((entry: unknown) => isDynamicRecord(entry) && entry.name === assetName)
    : null;
  if (
    !version ||
    !assetName ||
    !isDynamicRecord(asset) ||
    !isString(asset.digest) ||
    !/^sha256:[a-f0-9]{64}$/u.test(asset.digest) ||
    !isNumber(asset.size) ||
    asset.size <= 0
  )
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
  return {
    ...pinned,
    source: "latest" as const,
    version,
    packageVersion: version,
    url: `https://github.com/${repo}/releases/download/${tagPrefix}${version}/${assetName}`,
    archiveDigest: { algorithm: "sha256" as const, hex: asset.digest.slice(7) },
    downloadBytes: asset.size,
  };
});

const LATEST_RELEASES: Record<
  ManagedProviderId,
  (context: LatestReleaseContext) => Effect.Effect<RuntimeSpec, ProviderRuntimeFailure>
> = {
  pi: ({ target, lock, fetch }) =>
    latestGitHubAsset(
      fetch,
      "earendil-works/pi",
      () => `pi-${target.replace("win32", "windows")}.${target === "win32-x64" ? "zip" : "tar.gz"}`,
      providerRuntimeDescriptor("pi").spec(target, lock),
    ),
  copilot: ({ target, lock, fetch }) =>
    latestGitHubAsset(
      fetch,
      "github/copilot-cli",
      () => `copilot-${target}.${target === "win32-x64" ? "zip" : "tar.gz"}`,
      providerRuntimeDescriptor("copilot").spec(target, lock),
    ),
  mistral: ({ target, lock, fetch }) =>
    latestGitHubAsset(
      fetch,
      "mistralai/mistral-vibe",
      (version) => `vibe-acp-${ACP_REGISTRY_TARGETS[target]}-${version}.${target === "win32-x64" ? "zip" : "tar.gz"}`,
      providerRuntimeDescriptor("mistral").spec(target, lock),
    ),
  muse: Effect.fn("ProviderRelease.muse")(function* ({ target, lock, fetch }: LatestReleaseContext) {
    const pinned = providerRuntimeDescriptor("muse").spec(target, lock);
    const channel = yield* fetchJsonEffect(fetch, "https://api.meta.ai/muse-code/channels/muse-stable");
    if (!isString(channel.version) || !/^\d+\.\d+\.\d+-R\d+(?:\.\d+)?$/u.test(channel.version))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    const base = `https://lookaside.facebook.com/lookaside/muse/download/?channel=muse&version=${encodeURIComponent(channel.version)}&file=`;
    const manifest = yield* fetchJsonEffect(fetch, `${base}manifest.json`);
    const targets: Record<RuntimeTarget, string> = {
      "darwin-arm64": "aarch64_macos",
      "darwin-x64": "x86_macos",
      "linux-arm64": "aarch64_linux",
      "linux-x64": "x86_linux",
      "win32-x64": "x86_windows",
    };
    const asset = isDynamicRecord(manifest.artifacts) ? manifest.artifacts[targets[target]] : null;
    if (
      manifest.version !== channel.version ||
      manifest.checksum_algorithm !== "sha256" ||
      !isDynamicRecord(asset) ||
      !isString(asset.checksum) ||
      !/^[a-f0-9]{64}$/u.test(asset.checksum) ||
      !isNumber(asset.size) ||
      asset.size <= 0 ||
      !isString(asset.url)
    )
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    const url = new URL(asset.url);
    if (
      url.origin !== "https://lookaside.facebook.com" ||
      url.pathname !== "/lookaside/muse/download/" ||
      url.searchParams.get("version") !== channel.version ||
      url.searchParams.get("channel") !== "muse"
    )
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    return {
      ...pinned,
      source: "latest" as const,
      version: channel.version,
      packageVersion: channel.version,
      url: url.toString(),
      archiveDigest: { algorithm: "sha256" as const, hex: asset.checksum },
      downloadBytes: asset.size,
      installedBytes: asset.size,
    };
  }),
  devin: Effect.fn("ProviderRelease.devin")(function* ({ target, lock, fetch }: LatestReleaseContext) {
    const pinned = providerRuntimeDescriptor("devin").spec(target, lock);
    const manifest = yield* fetchJsonEffect(fetch, "https://static.devin.ai/cli/current/manifest.json");
    const triples: Record<RuntimeTarget, string> = {
      "darwin-arm64": "aarch64-apple-darwin",
      "darwin-x64": "x86_64-apple-darwin",
      "linux-arm64": "aarch64-unknown-linux",
      "linux-x64": "x86_64-unknown-linux",
      "win32-x64": "x86_64-pc-windows",
    };
    const version = isString(manifest.version) && VERSION.test(manifest.version) ? manifest.version : null;
    const asset = isDynamicRecord(manifest.platforms) ? manifest.platforms[triples[target]] : null;
    const extension = target === "win32-x64" ? "zip" : "tar.gz";
    if (
      !version ||
      !isDynamicRecord(asset) ||
      !isString(asset.sha256) ||
      !/^[a-f0-9]{64}$/u.test(asset.sha256) ||
      !isString(asset.url)
    )
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    const url = new URL(asset.url);
    if (
      url.origin !== "https://static.devin.ai" ||
      url.pathname !== `/cli/${version}/devin-${version}-${triples[target]}.${extension}` ||
      url.search !== ""
    )
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    return {
      ...pinned,
      source: "latest" as const,
      version,
      packageVersion: version,
      url: url.toString(),
      archiveDigest: { algorithm: "sha256" as const, hex: asset.sha256 },
      downloadBytes: yield* downloadSizeEffect(fetch, url.toString()),
    };
  }),
  codex: Effect.fn("ProviderRelease.codex")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("codex").spec(target, lock);
    const api = lock.codex.repository.replace("https://github.com/", "https://api.github.com/repos/");
    const release = yield* fetchJsonEffect(fetch, `${api}/releases/latest`, { Accept: "application/vnd.github+json" });
    const version = isString(release.tag_name) ? versionFromTag(release.tag_name, "rust-v") : null;
    if (!(version && Array.isArray(release.assets))) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.codexReleaseShape")) });
    }
    const name = lock.codex.artifacts[target].asset;
    const asset = release.assets.find((entry: unknown) => isDynamicRecord(entry) && entry.name === name);
    const sha256 =
      isDynamicRecord(asset) && isString(asset.digest) ? /^sha256:([0-9a-f]{64})$/u.exec(asset.digest)?.[1] : null;
    if (!(sha256 && isDynamicRecord(asset) && isNumber(asset.size) && asset.size > 0)) {
      return yield* new ProviderRuntimeFailure({
        cause: new Error(sourceText("error.provider.codexReleaseNoDownload")),
      });
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
  }),
  claude: Effect.fn("ProviderRelease.claude")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("claude").spec(target, lock);
    const sdk = yield* fetchJsonEffect(fetch, `${lock.claude.registry}/@anthropic-ai/claude-agent-sdk/latest`);
    const sdkVersion = isString(sdk.version) ? sdk.version : null;
    const cliVersion = isString(sdk.claudeCodeVersion) ? sdk.claudeCodeVersion : null;
    if (!(sdkVersion && cliVersion && VERSION.test(sdkVersion) && VERSION.test(cliVersion))) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.claudeReleaseShape")) });
    }
    const artifact = yield* npmArtifactEffect(
      fetch,
      lock.claude.registry,
      lock.claude.artifacts[target].package,
      sdkVersion,
    );
    return { ...pinned, ...artifact, version: cliVersion, packageVersion: sdkVersion, source: "latest" };
  }),
  opencode: Effect.fn("ProviderRelease.opencode")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("opencode").spec(target, lock);
    const umbrella = yield* fetchJsonEffect(fetch, `${lock.opencode.registry}/${OPENCODE_CLI_PACKAGE}/latest`);
    const version = isString(umbrella.version) && VERSION.test(umbrella.version) ? umbrella.version : null;
    if (!version)
      return yield* new ProviderRuntimeFailure({
        cause: new Error(sourceText("error.provider.releaseNoDownload", { name: OPENCODE_CLI_PACKAGE })),
      });
    const artifact = yield* npmArtifactEffect(
      fetch,
      lock.opencode.registry,
      lock.opencode.artifacts[target].package,
      version,
    );
    return { ...pinned, ...artifact, version: artifact.packageVersion, source: "latest" };
  }),
  grok: Effect.fn("ProviderRelease.grok")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("grok").spec(target, lock);
    const response = yield* requestEffect(fetch, `${lock.grok.distribution}/stable`);
    const version = (yield* readTextEffect(response)).trim();
    if (!VERSION.test(version))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.grokReleaseVersion")) });
    const asset = lock.grok.artifacts[target].asset.replace(`grok-${lock.grok.version}-`, `grok-${version}-`);
    const url = `${lock.grok.distribution}/${asset}`;
    return {
      ...pinned,
      version,
      packageVersion: version,
      source: "latest",
      url,
      archiveDigest: null,
      downloadBytes: yield* downloadSizeEffect(fetch, url),
    };
  }),
  antigravity: ({ target, lock, fetch }) =>
    latestGitHubAsset(
      fetch,
      "google-antigravity/antigravity-cli",
      () => `agy_cli_${ANTIGRAVITY_TARGETS[target]}.${target === "win32-x64" ? "zip" : "tar.gz"}`,
      providerRuntimeDescriptor("antigravity").spec(target, lock),
      "",
    ),
  cursor: Effect.fn("ProviderRelease.cursor")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("cursor").spec(target, lock);
    const agent = yield* fetchJsonEffect(fetch, lock.cursor.registry);
    const date = isString(agent.version) && CURSOR_DATE.test(agent.version) ? agent.version : null;
    const binary = isDynamicRecord(agent.distribution) ? agent.distribution.binary : null;
    const entry = isDynamicRecord(binary) ? binary[ACP_REGISTRY_TARGETS[target]] : null;
    const artifact = lock.cursor.artifacts[target];
    const url = isDynamicRecord(entry) && isString(entry.archive) ? entry.archive : null;
    const prefix = `${lock.cursor.distribution}/`;
    const version = url?.startsWith(prefix) ? url.slice(prefix.length).split("/")[0] : undefined;
    const command =
      target === "win32-x64" ? `./dist-package\\${artifact.executable}` : `./dist-package/${artifact.executable}`;
    if (
      !(date && version && CURSOR_BUILD.test(version) && version.startsWith(`${date}-`)) ||
      url !== cursorPackageUrl(lock.cursor.distribution, version, artifact) ||
      !isDynamicRecord(entry) ||
      entry.cmd !== command
    ) {
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.cursorReleaseShape")) });
    }
    return {
      ...pinned,
      version,
      packageVersion: version,
      source: "latest",
      url,
      archiveDigest: null,
      downloadBytes: yield* downloadSizeEffect(fetch, url),
    };
  }),
  cline: Effect.fn("ProviderRuntime.cline.latest")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("cline").spec(target, lock);
    const artifact = yield* npmArtifactEffect(
      fetch,
      lock.cline.registry,
      lock.cline.artifacts[target].package,
      "latest",
    );
    return { ...pinned, ...artifact, version: artifact.packageVersion, source: "latest" };
  }),
  kimi: Effect.fn("ProviderRelease.kimi")(function* ({ target, lock, fetch }: LatestReleaseContext) {
    const pinned = providerRuntimeDescriptor("kimi").spec(target, lock);
    const release = yield* fetchJsonEffect(fetch, "https://api.github.com/repos/MoonshotAI/kimi-cli/releases/latest", {
      Accept: "application/vnd.github+json",
    });
    const version = isString(release.tag_name) && VERSION.test(release.tag_name) ? release.tag_name : null;
    const assetName = version ? kimiAssetName(version, target) : null;
    const asset = Array.isArray(release.assets)
      ? release.assets.find((entry: unknown) => isDynamicRecord(entry) && entry.name === assetName)
      : null;
    if (
      !version ||
      !assetName ||
      !isDynamicRecord(asset) ||
      !isString(asset.digest) ||
      !/^sha256:[a-f0-9]{64}$/u.test(asset.digest) ||
      !isNumber(asset.size) ||
      asset.size <= 0
    )
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    return {
      ...pinned,
      source: "latest" as const,
      version,
      packageVersion: version,
      url: `${lock.kimi.repository}/releases/download/${encodeURIComponent(version)}/${assetName}`,
      archiveDigest: { algorithm: "sha256" as const, hex: asset.digest.slice(7) },
      downloadBytes: asset.size,
    };
  }),
};

export function latestRelease(
  provider: ManagedProviderId,
  context: LatestReleaseContext,
): Effect.Effect<RuntimeSpec, ProviderRuntimeFailure> {
  return LATEST_RELEASES[provider](context);
}
export const fetchBlockedVersions = Effect.fn("ProviderRelease.fetchBlockedVersions")(function* (
  fetch: Fetch,
): Effect.fn.Return<BlockedVersions, ProviderRuntimeFailure> {
  const value = yield* fetchJsonEffect(fetch, BLOCKED_VERSIONS_URL);
  if (!(value.schemaVersion === 1 && isDynamicRecord(value.blocked))) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.blockedListShape")) });
  }
  const blocked = new Map<ManagedProviderId, ReadonlySet<string>>();
  for (const provider of MANAGED_RUNTIME_PROVIDERS) {
    const versions = value.blocked[provider];
    if (Array.isArray(versions)) blocked.set(provider, new Set(versions.filter(isString)));
  }
  return blocked;
});

const npmArtifactEffect = Effect.fn("ProviderRelease.npmArtifact")(function* (
  fetch: Fetch,
  registry: string,
  packageName: string,
  version: string,
): Effect.fn.Return<
  Pick<RuntimeSpec, "packageVersion" | "url" | "archiveDigest" | "downloadBytes">,
  ProviderRuntimeFailure
> {
  const manifest = yield* fetchJsonEffect(fetch, `${registry}/${packageName}/${version}`);
  const dist = manifest.dist;
  const packageVersion = isString(manifest.version) ? manifest.version : null;
  const tarball = isDynamicRecord(dist) && isString(dist.tarball) ? dist.tarball : null;
  const integrity = isDynamicRecord(dist) && isString(dist.integrity) ? sha512Hex(dist.integrity) : null;
  if (
    !(packageVersion && VERSION.test(packageVersion) && tarball?.startsWith(`${registry}/${packageName}/-/`)) ||
    !integrity
  ) {
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.releaseNoDownload", { name: packageName })),
    });
  }
  return {
    packageVersion,
    url: tarball,
    archiveDigest: { algorithm: "sha512", hex: integrity },
    downloadBytes: yield* downloadSizeEffect(fetch, tarball),
  };
});

function sha512Hex(integrity: string): string | null {
  const match = /^sha512-([A-Za-z0-9+/]{86}==)$/u.exec(integrity);
  return match?.[1] ? Buffer.from(match[1], "base64").toString("hex") : null;
}

function versionFromTag(tag: string, prefix: "rust-v" | "v" | ""): string | null {
  const version = tag.startsWith(prefix) ? tag.slice(prefix.length) : "";
  return VERSION.test(version) ? version : null;
}

const downloadSizeEffect = Effect.fn("ProviderRelease.downloadSize")(function* (
  fetch: Fetch,
  url: string,
): Effect.fn.Return<number, ProviderRuntimeFailure> {
  const response = yield* runtimeIO((signal) =>
    fetch(url, {
      headers: { ...HEADERS, Range: "bytes=0-0" },
      redirect: "follow",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    }),
  );
  yield* runtimeIO(async () => {
    await response.body?.cancel();
  }).pipe(Effect.catch(() => Effect.void));
  const total =
    response.status === 206
      ? Number(/\/(\d+)$/u.exec(response.headers.get("content-range") ?? "")?.[1])
      : Number(response.headers.get("content-length"));
  if (!(response.ok && Number.isSafeInteger(total) && total > 0)) {
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.releaseSizeUnknown")) });
  }
  return total;
});

const fetchJsonEffect = Effect.fn("ProviderRelease.fetchJson")(function* (
  fetch: Fetch,
  url: string,
  headers: Record<string, string> = {},
): Effect.fn.Return<DynamicRecord, ProviderRuntimeFailure> {
  const text = yield* readTextEffect(yield* requestEffect(fetch, url, headers));
  const value = yield* runtimeSync(() => JSON.parse(text));
  if (!isDynamicRecord(value))
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.releaseMetadataNotObject")),
    });
  return value;
});

const requestEffect = Effect.fn("ProviderRelease.request")(function* (
  fetch: Fetch,
  url: string,
  headers: Record<string, string> = {},
): Effect.fn.Return<Response, ProviderRuntimeFailure> {
  const response = yield* runtimeIO((signal) =>
    fetch(url, {
      headers: { ...HEADERS, ...headers },
      redirect: "follow",
      signal: AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]),
    }),
  );
  if (!response.ok) {
    yield* runtimeIO(async () => {
      await response.body?.cancel();
    }).pipe(Effect.catch(() => Effect.void));
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.releaseCheckHttp", { status: response.status })),
    });
  }
  return response;
});

const readTextEffect = Effect.fn("ProviderRelease.readText")(function* (
  response: Response,
): Effect.fn.Return<string, ProviderRuntimeFailure> {
  const value = yield* readLimitedBody(response, sourceText("error.provider.releaseMetadataTooLarge"));
  return value ? new TextDecoder().decode(value) : "";
});
export const readLimitedBody = Effect.fn("ProviderRelease.readLimitedBody")(function* (
  response: Response,
  tooLargeMessage: string,
): Effect.fn.Return<Uint8Array | null, ProviderRuntimeFailure> {
  if (Number(response.headers.get("content-length") ?? 0) > MAX_METADATA_BYTES) {
    yield* runtimeIO(async () => {
      await response.body?.cancel();
    }).pipe(Effect.catch(() => Effect.void));
    return yield* new ProviderRuntimeFailure({ cause: new Error(tooLargeMessage) });
  }
  const body = response.body;
  if (!body) return null;
  return yield* Effect.acquireUseRelease(
    Effect.sync(() => body.getReader()),
    (reader) =>
      Effect.gen(function* () {
        const chunks: Uint8Array[] = [];
        let size = 0;
        while (true) {
          const chunk = yield* runtimeIO(() => reader.read());
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > MAX_METADATA_BYTES)
            return yield* new ProviderRuntimeFailure({ cause: new Error(tooLargeMessage) });
          chunks.push(chunk.value);
        }
        const value = new Uint8Array(size);
        let offset = 0;
        for (const chunk of chunks) {
          value.set(chunk, offset);
          offset += chunk.byteLength;
        }
        return value;
      }),
    (reader) =>
      runtimeIO(() => reader.cancel()).pipe(
        Effect.catch(() => Effect.void),
        Effect.ensuring(Effect.sync(() => reader.releaseLock())),
      ),
  );
});
