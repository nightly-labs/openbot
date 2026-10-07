import { createHash, randomUUID } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readdir, readFile, realpath } from "node:fs/promises";
import { extname, isAbsolute, join, relative, resolve } from "node:path";
import {
  checkHostedSitePath,
  HOSTED_SITE_HOST_ID_HEADER,
  HOSTED_SITE_HOST_TOKEN_HEADER,
  HOSTED_SITE_MIME_TYPES,
  HOSTED_SITE_UPLOAD_LIMITS,
  type HostedSitePathProblem,
  parseHostedSiteList,
  parseHostedSiteSummary,
} from "@openbot/contracts/hosted-sites";
import type {
  HostedSiteFramework,
  HostedSiteList,
  HostedSiteSummary,
  PublishHostedSiteInput,
  ReplaceHostedSiteInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { type SourceMessages, sourceText } from "@openbot/i18n/source";
import { Deferred, Effect, Result, Schema } from "effect";
import { causeHelpers } from "../backend/effect-boundary";
import { isMissingFileError } from "../backend/file-errors";
import type { CentralAuthOperationError } from "./central-auth-effects";

const PATH_PROBLEM_KEYS = {
  invalid: "error.site.unsafePath",
  hidden: "error.site.hiddenFile",
  unsafe: "error.site.unsafePath",
  secret: "error.site.secretFile",
  archive: "error.site.fileType",
} as const satisfies Record<HostedSitePathProblem, keyof SourceMessages>;

interface PreparedFile {
  path: string;
  size: number;
  mimeType: string;
  bytes: Uint8Array;
}

interface PreparedSite {
  framework: HostedSiteFramework;
  files: PreparedFile[];
}

interface UploadSession {
  uploadId: string;
  expiresAt: string;
}

interface PendingUpload {
  uploadKey: string;
  activationKey: string;
  session: UploadSession | null;
  uploadedPaths: Set<string>;
  createdAt: number;
  inFlight: Deferred.Deferred<HostedSiteSummary, HostedSiteFailure> | null;
}

export interface HostedSiteAuthClient {
  requestAuthorized<T>(
    path: string,
    init: RequestInit,
    decoder: (value: unknown) => T,
    timeoutMs?: number,
  ): Effect.Effect<T, CentralAuthOperationError>;
}

/** The registered server of this computer and its machine token. The token is a secret: never log it. */
export interface HostedSiteServerCredential {
  hostId: string;
  machineToken: string;
}

const UNLINKED_SCOPE = "?scope=unlinked";

/**
 * The sites of this computer's server. A computer that is a registered server proves it with its machine
 * token, and its new sites count against the server's plan. Without a credential, the account's unlinked
 * bucket holds the sites. The list shows both, because the unlinked sites belong to this computer's account.
 */
export class HostedSiteDesktopService {
  readonly #pendingUploads = new Map<string, PendingUpload>();

  constructor(
    private readonly auth: HostedSiteAuthClient,
    private readonly serverCredential: () => HostedSiteServerCredential | null = () => null,
  ) {}

  list(): Effect.Effect<HostedSiteList, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const credential = this.serverCredential();
      const unlinked = this.auth
        .requestAuthorized(`/v1/sites/${UNLINKED_SCOPE}`, { method: "GET" }, decodeSiteList)
        .pipe(toHostedSiteFailure);
      if (!credential) return yield* unlinked;
      const [server, account] = yield* Effect.all(
        [
          this.auth
            .requestAuthorized("/v1/sites/", { method: "GET", headers: serverHeaders(credential) }, decodeSiteList)
            .pipe(toHostedSiteFailure),
          unlinked,
        ],
        { concurrency: "unbounded" },
      );
      const shown = new Set(server.sites.map((site) => site.id));
      const unlinkedSites = account.sites.filter((site) => !shown.has(site.id));
      return { sites: [...server.sites, ...unlinkedSites], limit: server.limit, used: server.used };
    });
  }

  publish(
    input: PublishHostedSiteInput,
    allowedRoots?: readonly string[],
  ): Effect.Effect<HostedSiteSummary, HostedSiteFailure> {
    return this.upload(input, null, allowedRoots);
  }

  replace(
    input: ReplaceHostedSiteInput,
    allowedRoots?: readonly string[],
  ): Effect.Effect<HostedSiteSummary, HostedSiteFailure> {
    return this.upload(input, input.siteId, allowedRoots);
  }

  /** Deletes a site of this server, or an unlinked site of this account. Only for this computer's own user. */
  delete(siteId: string): Effect.Effect<void, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const key = operationKey("delete");
      const credential = this.serverCredential();
      if (credential) {
        const result = yield* Effect.result(this.deleteSite(siteId, key, serverHeaders(credential)));
        if (Result.isSuccess(result)) return;
        const error = result.failure.cause;
        if (!(error instanceof Error && "code" in error && error.code === "site_other_server"))
          return yield* result.failure;
      }
      yield* this.deleteSite(siteId, key, {}, UNLINKED_SCOPE);
    });
  }

  /**
   * The sites of this server only, for a member on a joined server. The unlinked sites belong to the owner's
   * account, not to the server, so a member never sees or deletes them.
   */

  listServerSites(): Effect.Effect<HostedSiteList, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const credential = yield* siteSync(() => this.requireServerCredential());
      const list = yield* this.auth
        .requestAuthorized("/v1/sites/", { method: "GET", headers: serverHeaders(credential) }, decodeSiteList)
        .pipe(toHostedSiteFailure);
      if (list.sites.some((site) => site.serverId !== credential.hostId))
        return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.team.hostedSitesUnsupported")) });
      return list;
    });
  }

  deleteServerSite(siteId: string): Effect.Effect<void, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const { sites } = yield* this.listServerSites();
      if (!sites.some((site) => site.id === siteId))
        return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.team.hostedSiteNotFound")) });
      const credential = yield* siteSync(() => this.requireServerCredential());
      return yield* this.deleteSite(siteId, operationKey("delete"), serverHeaders(credential));
    });
  }

  /**
   * A site that this computer published before it was a registered server is in the account's unlinked
   * bucket. The Worker refuses it in the server scope before it claims the key, so the same key can update it.
   */
  private createSession(
    create: (headers: Record<string, string>, query?: string) => Effect.Effect<UploadSession, HostedSiteFailure>,
    siteId: string | null,
  ): Effect.Effect<UploadSession, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const credential = this.serverCredential();
      if (!credential) return yield* create({});
      const result = yield* Effect.result(create(serverHeaders(credential)));
      if (Result.isSuccess(result)) return result.success;
      const error = result.failure.cause;
      if (siteId === null || !(error instanceof Error && "code" in error && error.code === "site_other_server"))
        return yield* result.failure;
      return yield* create({}, UNLINKED_SCOPE);
    });
  }

  private requireServerCredential(): HostedSiteServerCredential {
    const credential = this.serverCredential();
    if (!credential) throw new Error(sourceText("error.team.hostedSitesUnregistered"));
    return credential;
  }

  private deleteSite(
    siteId: string,
    key: string,
    headers: Record<string, string>,
    query = "",
  ): Effect.Effect<void, HostedSiteFailure> {
    return this.auth
      .requestAuthorized(
        `/v1/sites/${encodeURIComponent(siteId)}${query}`,
        { method: "DELETE", headers: { "Idempotency-Key": key, ...headers } },
        decodeDeleteResult,
      )
      .pipe(toHostedSiteFailure);
  }

  private readonly upload = Effect.fn("HostedSite.upload")(function* (
    this: HostedSiteDesktopService,
    input: PublishHostedSiteInput,
    siteId: string | null,
    allowedRoots?: readonly string[],
  ) {
    const prepared = yield* prepareSite(input.sourcePath, allowedRoots);
    this.prunePendingUploads();
    const signature = uploadSignature(input, siteId, prepared);
    let pending = this.#pendingUploads.get(signature);
    if (!pending) {
      pending = {
        uploadKey: operationKey(siteId ? "replace" : "publish"),
        activationKey: operationKey("activate"),
        session: null,
        uploadedPaths: new Set(),
        createdAt: Date.now(),
        inFlight: null,
      };
      this.#pendingUploads.set(signature, pending);
    }
    if (pending.inFlight) return yield* Deferred.await(pending.inFlight);
    const done = Deferred.makeUnsafe<HostedSiteSummary, HostedSiteFailure>();
    pending.inFlight = done;
    const entry = pending;
    return yield* this.performUpload(input, siteId, prepared, entry).pipe(
      Effect.tap(() => Effect.sync(() => this.#pendingUploads.delete(signature))),
      Effect.onExit((exit) => Deferred.done(done, exit)),
      Effect.ensuring(
        Effect.sync(() => {
          entry.inFlight = null;
        }),
      ),
    );
  }).bind(this);

  private performUpload(
    input: PublishHostedSiteInput,
    siteId: string | null,
    prepared: PreparedSite,
    pending: PendingUpload,
  ): Effect.Effect<HostedSiteSummary, HostedSiteFailure> {
    return Effect.gen({ self: this }, function* () {
      const createSession = (headers: Record<string, string>, query = "") =>
        retryTransport(() =>
          this.auth.requestAuthorized(
            `/v1/sites/${query}`,
            {
              method: "POST",
              headers: {
                "Content-Type": "application/json",
                "Idempotency-Key": pending.uploadKey,
                ...headers,
              },
              body: JSON.stringify({
                title: input.title,
                description: input.description,
                framework: prepared.framework,
                ...(siteId === null || input.spaFallback !== undefined
                  ? { spaFallback: input.spaFallback ?? false }
                  : {}),
                siteId,
                files: prepared.files.map(({ path, size, mimeType }) => ({ path, size, mimeType })),
              }),
            },
            decodeUploadSession,
          ),
        );
      const session = pending.session ?? (yield* this.createSession(createSession, siteId));
      pending.session = session;
      for (const file of prepared.files) {
        if (pending.uploadedPaths.has(file.path)) continue;
        yield* retryTransport(() =>
          this.auth.requestAuthorized(
            `/v1/sites/uploads/${encodeURIComponent(session.uploadId)}/file?path=${encodeURIComponent(file.path)}`,
            {
              method: "PUT",
              headers: {
                "Content-Type": file.mimeType,
                "Content-Length": String(file.size),
              },
              body: arrayBuffer(file.bytes),
            },
            decodeUploadResult,
            30_000,
          ),
        );
        pending.uploadedPaths.add(file.path);
      }
      return yield* retryTransport(() =>
        this.auth.requestAuthorized(
          `/v1/sites/uploads/${encodeURIComponent(session.uploadId)}/activate`,
          { method: "POST", headers: { "Idempotency-Key": pending.activationKey } },
          decodeSite,
          30_000,
        ),
      );
    });
  }

  private prunePendingUploads(): void {
    const now = Date.now();
    for (const [signature, pending] of this.#pendingUploads) {
      const serverExpiry = pending.session ? Date.parse(pending.session.expiresAt) : Number.NaN;
      const expiresAt = Number.isFinite(serverExpiry)
        ? serverExpiry
        : pending.createdAt + HOSTED_SITE_UPLOAD_LIMITS.uploadLifetimeMs;
      if (pending.inFlight === null && expiresAt <= now) this.#pendingUploads.delete(signature);
    }
  }
}

export const prepareSite = Effect.fn("HostedSite.prepare")(function* (
  sourcePath: string,
  allowedRoots?: readonly string[],
): Effect.fn.Return<PreparedSite, HostedSiteFailure> {
  if (!isAbsolute(sourcePath))
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.absolutePath")) });
  const selectedRoot = resolve(sourcePath);
  const selectedRootStats = yield* siteIO(() => lstat(selectedRoot));
  if (selectedRootStats.isSymbolicLink())
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.rootSymlink")) });
  if (!selectedRootStats.isDirectory())
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.notDirectory")) });
  const root = yield* siteIO(() => realpath(selectedRoot));
  if (allowedRoots?.length) {
    const roots = yield* Effect.forEach(allowedRoots, (candidate) => siteIO(() => realpath(resolve(candidate))), {
      concurrency: "unbounded",
    });
    if (!roots.some((candidate) => isInside(candidate, root))) {
      return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.outsideWorkspace")) });
    }
  }
  const framework = yield* detectFramework(root);
  const output = framework === "astro" ? yield* staticAstroOutput(root) : root;
  return { framework, files: yield* collectFiles(output) };
});

const detectFramework = Effect.fn("HostedSite.detectFramework")(function* (
  root: string,
): Effect.fn.Return<HostedSiteFramework, HostedSiteFailure> {
  const packagePath = join(root, "package.json");
  const parsed = yield* Effect.result(
    siteIO(() => readFile(packagePath, "utf8")).pipe(Effect.flatMap((text) => siteSync(() => JSON.parse(text)))),
  );
  if (Result.isSuccess(parsed)) {
    const value = parsed.success;
    if (
      isDynamicRecord(value) &&
      [value.dependencies, value.devDependencies].some((group) => isDynamicRecord(group) && isString(group.astro))
    )
      return "astro";
  } else if (!isMissingFileError(parsed.failure.cause))
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.packageJsonInvalid")) });
  for (const name of ["astro.config.mjs", "astro.config.js", "astro.config.ts"]) {
    const found = yield* Effect.result(siteIO(() => lstat(join(root, name))));
    if (Result.isSuccess(found)) return "astro";
    if (!isMissingFileError(found.failure.cause)) return yield* found.failure;
  }
  return "vanilla";
});

const staticAstroOutput = Effect.fn("HostedSite.staticAstroOutput")(function* (
  root: string,
): Effect.fn.Return<string, HostedSiteFailure> {
  const configPath = yield* firstExisting(
    ["astro.config.mjs", "astro.config.js", "astro.config.ts"].map((name) => join(root, name)),
  );
  if (configPath) {
    const config = yield* siteIO(() => readFile(configPath, "utf8"));
    if (/output\s*:\s*["'](?:server|hybrid)["']/u.test(config))
      return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroServerOutput")) });
    if (/adapter|@astrojs\/react|integrations\s*:\s*\[[^\]]*react/isu.test(config)) {
      return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroAdapter")) });
    }
  }
  const forbidden = [join(root, "src", "pages", "api"), join(root, "src", "actions")];
  for (const path of forbidden) {
    if (yield* exists(path))
      return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroApiRoutes")) });
  }
  const sourceEntries = yield* siteIO(() => readdir(join(root, "src"), { recursive: true }).catch(() => []));
  if (sourceEntries.some((entry) => /(^|\/)(?:middleware|[^/]+\.server)\.[cm]?[jt]s$/u.test(String(entry)))) {
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroMiddleware")) });
  }
  const output = join(root, "dist");
  const stats = yield* siteIO(() =>
    lstat(output).catch((error: unknown) => {
      if (isMissingFileError(error)) throw new Error(sourceText("error.site.astroNotBuilt"));
      throw error;
    }),
  );
  if (stats.isSymbolicLink() || !stats.isDirectory())
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroDistNotDirectory")) });
  const canonicalOutput = yield* siteIO(() => realpath(output));
  if (!isInside(root, canonicalOutput))
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.astroDistOutside")) });
  return canonicalOutput;
});

const collectFiles = Effect.fn("HostedSite.collectFiles")(function* (
  root: string,
): Effect.fn.Return<PreparedFile[], HostedSiteFailure> {
  const files: PreparedFile[] = [];
  let total = 0;
  function visit(directory: string): Effect.Effect<void, HostedSiteFailure> {
    return Effect.gen(function* () {
      const canonicalDirectory = yield* siteIO(() => realpath(directory));
      if (!isInside(root, canonicalDirectory))
        return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.directoryOutsideRoot")) });
      const entries = yield* siteIO(() => readdir(directory, { withFileTypes: true }));
      entries.sort((left, right) => left.name.localeCompare(right.name));
      for (const entry of entries) {
        const absolute = join(directory, entry.name);
        const stats = yield* siteIO(() => lstat(absolute));
        if (stats.isSymbolicLink())
          return yield* new HostedSiteFailure({
            cause: new Error(sourceText("error.site.symlink", { name: entry.name })),
          });
        if (stats.isDirectory()) {
          yield* visit(absolute);
          continue;
        }
        if (!stats.isFile())
          return yield* new HostedSiteFailure({
            cause: new Error(sourceText("error.site.unsupportedEntry", { name: entry.name })),
          });
        if (files.length >= HOSTED_SITE_UPLOAD_LIMITS.files) {
          return yield* new HostedSiteFailure({
            cause: new Error(sourceText("error.site.tooManyFiles", { limit: HOSTED_SITE_UPLOAD_LIMITS.files })),
          });
        }
        const path = relative(root, absolute).split("\\").join("/");
        const checked = checkHostedSitePath(path);
        if ("problem" in checked)
          return yield* new HostedSiteFailure({
            cause: new Error(sourceText(PATH_PROBLEM_KEYS[checked.problem], { path })),
          });
        const mimeType = HOSTED_SITE_MIME_TYPES[extname(path).slice(1).toLowerCase()]?.[0];
        if (!mimeType)
          return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.fileType", { path })) });
        yield* Effect.acquireUseRelease(
          siteIO(() => open(absolute, constants.O_RDONLY | constants.O_NOFOLLOW)),
          (handle) =>
            Effect.gen(function* () {
              const openedStats = yield* siteIO(() => handle.stat());
              const canonicalFile = yield* siteIO(() => realpath(absolute));
              if (!openedStats.isFile() || !isInside(root, canonicalFile) || canonicalFile !== absolute) {
                return yield* new HostedSiteFailure({
                  cause: new Error(sourceText("error.site.fileOutsideRoot", { path })),
                });
              }
              if (openedStats.size > HOSTED_SITE_UPLOAD_LIMITS.fileBytes)
                return yield* new HostedSiteFailure({
                  cause: new Error(sourceText("error.site.fileTooLarge", { path })),
                });
              total += openedStats.size;
              if (total > HOSTED_SITE_UPLOAD_LIMITS.totalBytes)
                return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.siteTooLarge")) });
              files.push({
                path,
                size: openedStats.size,
                mimeType,
                bytes: new Uint8Array(yield* siteIO(() => handle.readFile())),
              });
            }),
          (handle) => siteIO(() => handle.close()).pipe(Effect.orDie),
        );
      }
    });
  }
  yield* visit(root);
  if (!files.some((file) => file.path === "index.html"))
    return yield* new HostedSiteFailure({ cause: new Error(sourceText("error.site.missingIndex")) });
  return files;
});

function decodeSiteList(value: unknown): HostedSiteList {
  const list = parseHostedSiteList(value);
  if (!list) throw new Error("The site list response is invalid.");
  return list;
}

function serverHeaders(credential: HostedSiteServerCredential | null): Record<string, string> {
  if (!credential) return {};
  return { [HOSTED_SITE_HOST_ID_HEADER]: credential.hostId, [HOSTED_SITE_HOST_TOKEN_HEADER]: credential.machineToken };
}

function decodeSite(value: unknown): HostedSiteSummary {
  const site = parseHostedSiteSummary(value);
  if (!site) throw new Error("The site response is invalid.");
  return site;
}

function decodeUploadSession(value: unknown): UploadSession {
  if (!isDynamicRecord(value) || !isString(value.uploadId) || !isString(value.expiresAt)) {
    throw new Error("The upload session response is invalid.");
  }
  return { uploadId: value.uploadId, expiresAt: value.expiresAt };
}

function decodeUploadResult(value: unknown): undefined {
  if (!isDynamicRecord(value) || value.uploaded !== true) throw new Error("The file upload response is invalid.");
  return undefined;
}

function decodeDeleteResult(value: unknown): undefined {
  if (!isDynamicRecord(value) || value.deleted !== true) throw new Error("The site deletion response is invalid.");
  return undefined;
}

function operationKey(operation: string): string {
  return `desktop:${operation}:${randomUUID()}`;
}

function uploadSignature(input: PublishHostedSiteInput, siteId: string | null, prepared: PreparedSite): string {
  const hash = createHash("sha256");
  hash.update(
    JSON.stringify({
      siteId,
      title: input.title,
      description: input.description,
      spaFallback: input.spaFallback,
      framework: prepared.framework,
      files: prepared.files.map(({ path, size, mimeType }) => ({ path, size, mimeType })),
    }),
  );
  for (const file of prepared.files) hash.update(file.bytes);
  return hash.digest("hex");
}

function retryTransport<A>(
  request: () => Effect.Effect<A, CentralAuthOperationError>,
): Effect.Effect<A, HostedSiteFailure> {
  const operation = Effect.suspend(request).pipe(toHostedSiteFailure);
  return operation.pipe(Effect.catch((error) => (isTransportFailure(error.cause) ? operation : Effect.fail(error))));
}

function isTransportFailure(error: unknown): boolean {
  return (
    error instanceof TypeError ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}

function arrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const copy = new Uint8Array(bytes.byteLength);
  copy.set(bytes);
  return copy.buffer;
}

function isInside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

const firstExisting = Effect.fn("HostedSite.firstExisting")(function* (
  paths: string[],
): Effect.fn.Return<string | null, HostedSiteFailure> {
  for (const path of paths) if (yield* exists(path)) return path;
  return null;
});

const exists = Effect.fn("HostedSite.exists")((path: string) =>
  siteIO(() => lstat(path)).pipe(
    Effect.as(true),
    Effect.catch((error) => (isMissingFileError(error.cause) ? Effect.succeed(false) : Effect.fail(error))),
  ),
);

export class HostedSiteFailure extends Schema.TaggedError<HostedSiteFailure>()("HostedSiteFailure", {
  cause: Schema.Defect(),
}) {}

const { io: siteIO, sync: siteSync, rewrap: toHostedSiteFailure } = causeHelpers(HostedSiteFailure);
