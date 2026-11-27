import { execFile } from "node:child_process";
import { createHash, createSign, createVerify, randomUUID, X509Certificate } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { promisify } from "node:util";
import {
  assetKey,
  decodeStoredUpdate,
  decodeUpdatePointer,
  type PointerHistoryEntry,
  type PointerTarget,
  pointerKey,
  SIGNING_ALGORITHM,
  SIGNING_KEY_ID,
  type StoredDirective,
  type StoredUpdate,
  type UpdatePlatform,
  type UpdatePointer,
  updateKey,
} from "../apps/mobile-updates/src/protocol";

export interface UpdateStore {
  read(key: string): Promise<string | null>;
  exists(key: string): Promise<boolean>;
  write(key: string, body: Uint8Array | string, contentType: string): Promise<void>;
}

export interface UpdateScope {
  channel: string;
  platform: UpdatePlatform;
  runtimeVersion: string;
}

interface ExportedFile {
  path: string;
  hash: string;
  key: string;
  contentType: string;
  fileExtension: string;
}

export interface ExportedUpdate {
  launch: ExportedFile;
  assets: ExportedFile[];
}

interface ManifestFields {
  readonly [key: string]: unknown;
  id: string;
  createdAt: string;
}

const HISTORY_LENGTH = 50;
const run = promisify(execFile);

export async function fingerprint(platform: UpdatePlatform, mobileDir: string): Promise<string> {
  const bin = join(mobileDir, "..", "..", "node_modules", ".bin", "expo-updates");
  const { stdout } = await run(bin, ["fingerprint:generate", "--platform", platform], {
    cwd: mobileDir,
    maxBuffer: 256 * 1024 * 1024,
  });
  const result = JSON.parse(stdout.slice(stdout.indexOf("{")));
  if (!isObject(result) || typeof result.hash !== "string" || result.hash.length === 0) {
    throw new Error(`No ${platform} fingerprint came back.`);
  }
  return result.hash;
}

const CONTENT_TYPES: Readonly<Partial<Record<string, string>>> = {
  css: "text/css",
  db: "application/octet-stream",
  gif: "image/gif",
  hbc: "application/javascript",
  html: "text/html",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  js: "application/javascript",
  json: "application/json",
  lottie: "application/json",
  m4a: "audio/mp4",
  mov: "video/quicktime",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  otf: "font/otf",
  pdf: "application/pdf",
  png: "image/png",
  svg: "image/svg+xml",
  ttf: "font/ttf",
  txt: "text/plain",
  wasm: "application/wasm",
  wav: "audio/wav",
  webp: "image/webp",
  woff: "font/woff",
  woff2: "font/woff2",
  xml: "application/xml",
};

async function exportedFile(exportDir: string, relativePath: string, extension: string | null) {
  const path = join(exportDir, relativePath);
  const bytes = await readFile(path);
  const file: ExportedFile = {
    path,
    hash: createHash("sha256").update(bytes).digest("base64url"),
    key: createHash("md5").update(bytes).digest("hex"),
    contentType:
      extension === null ? "application/javascript" : (CONTENT_TYPES[extension] ?? "application/octet-stream"),
    fileExtension: extension === null ? ".bundle" : `.${extension}`,
  };
  return file;
}

function isObject(value: unknown): value is { readonly [key: string]: unknown } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function readExport(exportDir: string, platform: UpdatePlatform): Promise<ExportedUpdate> {
  const metadata = JSON.parse(await readFile(join(exportDir, "metadata.json"), "utf8"));
  const files = isObject(metadata) && isObject(metadata.fileMetadata) ? metadata.fileMetadata[platform] : null;
  if (!isObject(files) || typeof files.bundle !== "string" || !Array.isArray(files.assets)) {
    throw new Error(`The export in ${exportDir} has no ${platform} bundle. Run expo export for ${platform}.`);
  }
  const assets: ExportedFile[] = [];
  for (const asset of files.assets) {
    if (!isObject(asset) || typeof asset.path !== "string" || typeof asset.ext !== "string") {
      throw new Error(`The export in ${exportDir} lists an asset that has no path or no type.`);
    }
    assets.push(await exportedFile(exportDir, asset.path, asset.ext));
  }
  return { launch: await exportedFile(exportDir, files.bundle, null), assets };
}

function manifestAsset(file: ExportedFile, assetBaseUrl: string) {
  return {
    hash: file.hash,
    key: file.key,
    contentType: file.contentType,
    fileExtension: file.fileExtension,
    url: `${assetBaseUrl}/${file.hash}`,
  };
}

function buildManifest(input: {
  id: string;
  createdAt: string;
  runtimeVersion: string;
  update: ExportedUpdate;
  assetBaseUrl: string;
  expoClient: object;
  commit: string;
  message: string;
}): string {
  return JSON.stringify({
    id: input.id,
    createdAt: input.createdAt,
    runtimeVersion: input.runtimeVersion,
    launchAsset: manifestAsset(input.update.launch, input.assetBaseUrl),
    assets: input.update.assets.map((asset) => manifestAsset(asset, input.assetBaseUrl)),
    metadata: {},
    extra: { expoClient: input.expoClient, openbot: { commit: input.commit, message: input.message } },
  });
}

export function signText(text: string, privateKeyPem: string): string {
  const signature = createSign("RSA-SHA256").update(text, "utf8").sign(privateKeyPem, "base64");
  return `sig="${signature}", keyid="${SIGNING_KEY_ID}", alg="${SIGNING_ALGORITHM}"`;
}

export function verifySignature(text: string, signature: string, certificatePem: string): boolean {
  const fields = new Map<string, string>();
  for (const match of signature.matchAll(/(\w+)="([^"]*)"/gu)) {
    if (match[1] !== undefined && match[2] !== undefined) fields.set(match[1], match[2]);
  }
  const sig = fields.get("sig");
  if (!sig || fields.get("keyid") !== SIGNING_KEY_ID) return false;
  const publicKey = new X509Certificate(certificatePem).publicKey;
  return createVerify("RSA-SHA256").update(text, "utf8").verify(publicKey, sig, "base64");
}

function signed(body: string, privateKeyPem: string, certificatePem: string): StoredDirective {
  const signature = signText(body, privateKeyPem);
  if (!verifySignature(body, signature, certificatePem)) {
    throw new Error(
      "The private key does not belong to the certificate in apps/mobile. Phones would refuse the update. Nothing changed.",
    );
  }
  return { body, signature };
}

export async function readPointer(store: UpdateStore, scope: UpdateScope): Promise<UpdatePointer | null> {
  const text = await store.read(pointerKey(scope.channel, scope.platform, scope.runtimeVersion));
  if (text === null) return null;
  const pointer = decodeUpdatePointer(text);
  if (!pointer) throw new Error(`The pointer of ${scopeName(scope)} is not valid. Correct it before a new change.`);
  return pointer;
}

async function readUpdate(store: UpdateStore, id: string): Promise<StoredUpdate> {
  const text = await store.read(updateKey(id));
  const update = text === null ? null : decodeStoredUpdate(text);
  if (!update) throw new Error(`The update ${id} is missing or not valid in the bucket.`);
  return update;
}

export function scopeName(scope: UpdateScope): string {
  return `${scope.platform} ${scope.channel} ${scope.runtimeVersion}`;
}

async function writePointer(
  store: UpdateStore,
  scope: UpdateScope,
  previous: UpdatePointer | null,
  target: PointerTarget,
  action: string,
  now: Date,
): Promise<UpdatePointer> {
  const entry: PointerHistoryEntry = {
    at: now.toISOString(),
    action,
    id: target.kind === "update" ? target.id : null,
  };
  const pointer: UpdatePointer = {
    version: 1,
    updatedAt: now.toISOString(),
    target,
    history: [entry, ...(previous?.history ?? [])].slice(0, HISTORY_LENGTH),
  };
  await store.write(
    pointerKey(scope.channel, scope.platform, scope.runtimeVersion),
    JSON.stringify(pointer),
    "application/json",
  );
  return pointer;
}

function settledUpdateId(pointer: UpdatePointer | null): string | null {
  if (pointer?.target.kind !== "update") return null;
  return pointer.target.rollout === 100 ? pointer.target.id : pointer.target.baseId;
}

async function writeUpdate(store: UpdateStore, update: StoredUpdate): Promise<void> {
  await store.write(updateKey(update.id), JSON.stringify(update), "application/json");
}

export interface SigningKeys {
  privateKeyPem: string;
  certificatePem: string;
}

export async function publishUpdate(
  store: UpdateStore,
  input: {
    scope: UpdateScope;
    update: ExportedUpdate;
    assetBaseUrl: string;
    expoClient: object;
    commit: string;
    message: string;
    rollout: number;
    keys: SigningKeys;
    now?: Date;
  },
): Promise<{ update: StoredUpdate; pointer: UpdatePointer; uploaded: number }> {
  assertRollout(input.rollout);
  const now = input.now ?? new Date();
  const previous = await readPointer(store, input.scope);
  const id = randomUUID();
  const manifest = signed(
    buildManifest({
      id,
      createdAt: now.toISOString(),
      runtimeVersion: input.scope.runtimeVersion,
      update: input.update,
      assetBaseUrl: input.assetBaseUrl,
      expoClient: input.expoClient,
      commit: input.commit,
      message: input.message,
    }),
    input.keys.privateKeyPem,
    input.keys.certificatePem,
  );
  let uploaded = 0;
  for (const file of [input.update.launch, ...input.update.assets]) {
    if (await store.exists(assetKey(file.hash))) continue;
    await store.write(assetKey(file.hash), await readFile(file.path), file.contentType);
    uploaded += 1;
  }
  const update: StoredUpdate = {
    version: 1,
    id,
    createdAt: now.toISOString(),
    platform: input.scope.platform,
    runtimeVersion: input.scope.runtimeVersion,
    channel: input.scope.channel,
    manifest: manifest.body,
    signature: manifest.signature,
    commit: input.commit,
    message: input.message,
    republishOf: null,
  };
  await writeUpdate(store, update);
  const pointer = await writePointer(
    store,
    input.scope,
    previous,
    { kind: "update", id, rollout: input.rollout, baseId: settledUpdateId(previous) },
    "publish",
    now,
  );
  return { update, pointer, uploaded };
}

function assertRollout(rollout: number): void {
  if (!Number.isInteger(rollout) || rollout < 1 || rollout > 100) {
    throw new Error("The rollout must be a whole number from 1 to 100.");
  }
}

export async function changeRollout(
  store: UpdateStore,
  scope: UpdateScope,
  rollout: number,
  now = new Date(),
): Promise<UpdatePointer> {
  assertRollout(rollout);
  const previous = await readPointer(store, scope);
  if (previous?.target.kind !== "update") {
    throw new Error(`${scopeName(scope)} has no update to roll out. Publish one first.`);
  }
  return writePointer(store, scope, previous, { ...previous.target, rollout }, `rollout ${rollout}`, now);
}

function manifestFields(text: string): ManifestFields {
  const value = JSON.parse(text);
  if (!isObject(value) || typeof value.id !== "string" || typeof value.createdAt !== "string") {
    throw new Error("A stored manifest has no ID or no date.");
  }
  return { ...value, id: value.id, createdAt: value.createdAt };
}

export async function rollBack(
  store: UpdateStore,
  input: { scope: UpdateScope; toEmbedded: boolean; keys: SigningKeys; now?: Date },
): Promise<{ pointer: UpdatePointer; republished: StoredUpdate | null }> {
  const now = input.now ?? new Date();
  const previous = await readPointer(store, input.scope);
  if (previous?.target.kind !== "update") {
    throw new Error(`${scopeName(input.scope)} has no update to take back.`);
  }
  const baseId = input.toEmbedded ? null : previous.target.baseId;
  if (baseId === null) {
    const directive = signed(
      JSON.stringify({ type: "rollBackToEmbedded", parameters: { commitTime: now.toISOString() } }),
      input.keys.privateKeyPem,
      input.keys.certificatePem,
    );
    const pointer = await writePointer(
      store,
      input.scope,
      previous,
      { kind: "embedded", directive },
      "rollback to embedded",
      now,
    );
    return { pointer, republished: null };
  }
  const base = await readUpdate(store, baseId);
  const id = randomUUID();
  const manifest = signed(
    JSON.stringify({ ...manifestFields(base.manifest), id, createdAt: now.toISOString() }),
    input.keys.privateKeyPem,
    input.keys.certificatePem,
  );
  const republished: StoredUpdate = {
    ...base,
    id,
    createdAt: now.toISOString(),
    manifest: manifest.body,
    signature: manifest.signature,
    republishOf: base.id,
  };
  await writeUpdate(store, republished);
  const pointer = await writePointer(
    store,
    input.scope,
    previous,
    { kind: "update", id, rollout: 100, baseId: null },
    `rollback to ${base.id}`,
    now,
  );
  return { pointer, republished };
}

export interface StoreBuild {
  platform: UpdatePlatform;
  version: string;
  build: string;
  runtimeVersion: string;
  commit: string;
}

const STORE_BUILD_TAG_PREFIX = "mobile-build/";

export function storeBuildTag(build: Omit<StoreBuild, "commit">): string {
  return `${STORE_BUILD_TAG_PREFIX}${build.platform}/${build.version}/${build.build}/${build.runtimeVersion}`;
}

export function parseStoreBuilds(lsRemote: string): StoreBuild[] {
  const builds: StoreBuild[] = [];
  for (const line of lsRemote.split("\n")) {
    const match =
      /^([0-9a-f]{40})\trefs\/tags\/mobile-build\/(ios|android)\/([0-9.]+)\/(\d+)\/([A-Za-z0-9._+-]+)$/u.exec(
        line.trim(),
      );
    if (!match) continue;
    const [, commit, platform, version, build, runtimeVersion] = match;
    if (!commit || !version || !build || !runtimeVersion || (platform !== "ios" && platform !== "android")) continue;
    builds.push({ platform, version, build, runtimeVersion, commit });
  }
  return builds.sort((a, b) => Number(b.build) - Number(a.build));
}

export async function liveUpdateScopes(
  store: UpdateStore,
  input: { channel: string; platforms: readonly UpdatePlatform[]; runtime: string | null; builds: StoreBuild[] },
): Promise<{ scopes: UpdateScope[]; skipped: UpdatePlatform[] }> {
  const hasUpdate = async (scope: UpdateScope) => (await readPointer(store, scope))?.target.kind === "update";
  const [onlyPlatform] = input.platforms;
  if (input.runtime !== null) {
    if (!onlyPlatform || input.platforms.length !== 1) {
      throw new Error("With --runtime, give one platform: iOS and Android have different runtime versions.");
    }
    const scope = { channel: input.channel, platform: onlyPlatform, runtimeVersion: input.runtime };
    if (!(await hasUpdate(scope))) throw new Error(`${scopeName(scope)} has no update.`);
    return { scopes: [scope], skipped: [] };
  }
  const scopes: UpdateScope[] = [];
  const skipped: UpdatePlatform[] = [];
  for (const platform of input.platforms) {
    const runtimes = new Set(
      input.builds.filter((build) => build.platform === platform).map((build) => build.runtimeVersion),
    );
    const live: UpdateScope[] = [];
    for (const runtimeVersion of runtimes) {
      const scope = { channel: input.channel, platform, runtimeVersion };
      if (await hasUpdate(scope)) live.push(scope);
    }
    const [scope] = live;
    if (live.length > 1) {
      throw new Error(
        `${platform} has an update for ${live.length} runtime versions: ${live.map((entry) => entry.runtimeVersion).join(", ")}. Give --platform ${platform} --runtime <version>. Nothing changed.`,
      );
    }
    if (scope) scopes.push(scope);
    else skipped.push(platform);
  }
  if (scopes.length === 0) {
    throw new Error(
      `No recorded store build of ${input.platforms.join(" and ")} has an update on the channel ${input.channel}. For a build with no tag, give --platform and --runtime.`,
    );
  }
  return { scopes, skipped };
}

export async function probeManifest(
  serverUrl: string,
  scope: UpdateScope,
  fetcher: (request: Request) => Promise<Response> = fetch,
): Promise<{ kind: "none" } | { kind: "update"; id: string; commit: string | null } | { kind: "embedded" }> {
  const response = await fetcher(
    new Request(`${serverUrl}/manifest`, {
      headers: {
        accept: "multipart/mixed",
        "expo-platform": scope.platform,
        "expo-protocol-version": "1",
        "expo-runtime-version": scope.runtimeVersion,
        "expo-channel-name": scope.channel,
        "expo-current-update-id": "00000000-0000-4000-8000-000000000000",
        "expo-embedded-update-id": "00000000-0000-4000-8000-000000000001",
      },
    }),
  );
  if (response.status === 204) return { kind: "none" };
  if (response.status !== 200)
    throw new Error(`The update server answered ${response.status} for ${scopeName(scope)}.`);
  const part = multipartParts(response.headers.get("content-type") ?? "", await response.text()).find(
    (candidate) => candidate.name === "manifest" || candidate.name === "directive",
  );
  if (!part) throw new Error(`The update server sent no manifest and no directive for ${scopeName(scope)}.`);
  if (part.name === "directive") return { kind: "embedded" };
  const manifest = manifestFields(part.body);
  const extra = isObject(manifest.extra) && isObject(manifest.extra.openbot) ? manifest.extra.openbot : null;
  return { kind: "update", id: manifest.id, commit: typeof extra?.commit === "string" ? extra.commit : null };
}

interface MultipartPart {
  name: string;
  headers: Map<string, string>;
  body: string;
}

export function multipartParts(contentType: string, body: string): MultipartPart[] {
  const boundary = /boundary=([^;]+)/u.exec(contentType)?.[1];
  if (!boundary) return [];
  const parts: MultipartPart[] = [];
  for (const section of body.split(`--${boundary}`)) {
    const separator = section.indexOf("\r\n\r\n");
    if (separator < 0) continue;
    const headers = new Map<string, string>();
    for (const line of section.slice(0, separator).split("\r\n")) {
      const colon = line.indexOf(":");
      if (colon > 0) headers.set(line.slice(0, colon).trim().toLowerCase(), line.slice(colon + 1).trim());
    }
    const name = /name="([^"]+)"/u.exec(headers.get("content-disposition") ?? "")?.[1];
    if (name) parts.push({ name, headers, body: section.slice(separator + 4).replace(/\r\n$/u, "") });
  }
  return parts;
}
