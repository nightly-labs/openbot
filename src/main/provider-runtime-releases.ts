import { MANAGED_RUNTIME_PROVIDERS, type ManagedProviderId } from "@openbot/contracts/ipc";
import { type DynamicRecord, isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import type { AgentRuntimeLock } from "../../scripts/agent-runtime-lock";
import {
  codexTag,
  cursorPackageUrl,
  providerRuntimeDescriptor,
  type RuntimeSpec,
  type RuntimeTarget,
} from "./provider-runtime-descriptors";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync } from "./provider-runtime-effects";

/**
 * The latest release of each provider CLI, read from the source that publishes it.
 *
 * OpenBot used to install only the version `native-runtime.lock.json` pinned, so a new CLI reached
 * users with the next OpenBot release. Providers ship faster than that, so the update offer now
 * follows upstream. The lock still names the version a first install uses when no source answers.
 *
 * Every download keeps a hash from its source: GitHub's asset `digest` for Codex and npm's
 * `dist.integrity` for Claude, OpenCode and Cline. x.ai publishes no hash for Grok, so a Grok release is
 * trusted on TLS alone, and so are Antigravity and Cursor from the ACP registry. Bun is a tool
 * runtime rather than a provider, and stays on the lock.
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
/**
 * Cursor's registry version is the date; the download folder adds the commit, and in the newer form
 * that Cursor's launcher accepts, the time before it.
 */
const CURSOR_DATE = /^\d{4}\.\d{2}\.\d{2}$/u;
const CURSOR_BUILD = /^\d{4}\.\d{2}\.\d{2}(?:-\d{2}-\d{2}-\d{2})?-[0-9a-f]{7,40}$/u;
const HEADERS = { "User-Agent": "OpenBot-runtime-installer" };

export type BlockedVersions = ReadonlyMap<ManagedProviderId, ReadonlySet<string>>;

/** The ACP registry's name for each target. */
const ACP_REGISTRY_TARGETS: Record<RuntimeTarget, string> = {
  "darwin-arm64": "darwin-aarch64",
  "darwin-x64": "darwin-x86_64",
  "linux-x64": "linux-x86_64",
  "linux-arm64": "linux-aarch64",
  "win32-x64": "windows-x86_64",
};

const LATEST_RELEASES: Record<
  ManagedProviderId,
  (context: LatestReleaseContext) => Effect.Effect<RuntimeSpec, ProviderRuntimeFailure>
> = {
  codex: Effect.fn("ProviderRelease.codex")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("codex").spec(target, lock);
    const api = lock.codex.repository.replace("https://github.com/", "https://api.github.com/repos/");
    const release = yield* fetchJsonEffect(fetch, `${api}/releases/latest`, { Accept: "application/vnd.github+json" });
    const version = isString(release.tag_name) ? versionFromTag(release.tag_name) : null;
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
    // The SDK's own package names the CLI version its platform packages carry.
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
    const artifact = yield* npmArtifactEffect(
      fetch,
      lock.opencode.registry,
      lock.opencode.artifacts[target].package,
      "latest",
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
  /**
   * Google publishes the server in the ACP registry, with no hash, so the latest release is trusted
   * on TLS alone, like Grok's. The download must stay on Google's release path and keep the layout
   * the pinned version has: a changed command means a changed archive, which staging would refuse.
   */
  antigravity: Effect.fn("ProviderRelease.antigravity")(function* ({
    target,
    lock,
    fetch,
  }: LatestReleaseContext): Effect.fn.Return<RuntimeSpec, ProviderRuntimeFailure> {
    const pinned = providerRuntimeDescriptor("antigravity").spec(target, lock);
    const agent = yield* fetchJsonEffect(fetch, lock.antigravity.registry);
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
      return yield* new ProviderRuntimeFailure({
        cause: new Error(sourceText("error.provider.antigravityReleaseShape")),
      });
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
  /**
   * Cursor publishes the CLI in the ACP registry, with no hash, so the latest release is trusted on
   * TLS alone. The registry names the date; the build, a date and a commit, is only in the URL. The
   * download must stay on Cursor's path for the pinned target and keep the pinned command.
   */
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

/** The parts of a spec one npm platform package decides. */
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
  // The download stays on the registry the lock names, whatever the manifest points at.
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

/** Every source answers with a JSON object; anything else is a failed check, not a value. */
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
