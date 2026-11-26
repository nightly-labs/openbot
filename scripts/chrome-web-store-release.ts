import { execFile } from "node:child_process";
import { createSign } from "node:crypto";
import { appendFileSync } from "node:fs";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { Option, Schema } from "effect";

const run = promisify(execFile);

const EXTENSION_ID = "eggdpikcggoicfcfdpdihfkinajchpfj";
const EXTENSION_NAME = "OpenBot";
const STORE_API = "https://chromewebstore.googleapis.com";
const STORE_SCOPE = "https://www.googleapis.com/auth/chromewebstore";
const PUBLIC_PACKAGE_URL = `https://clients2.google.com/service/update2/crx?response=redirect&prodversion=142.0&acceptformat=crx3&x=id%3D${EXTENSION_ID}%26uc`;
const UPLOAD_POLL_INTERVAL_MS = 5_000;
const UPLOAD_DEADLINE_MS = 10 * 60_000;
const REQUEST_TIMEOUT_MS = 120_000;

class ReleaseStop extends Error {}

const Manifest = Schema.Struct({
  name: Schema.String,
  version: Schema.String,
  permissions: Schema.optional(Schema.Array(Schema.String)),
  optional_permissions: Schema.optional(Schema.Array(Schema.String)),
  host_permissions: Schema.optional(Schema.Array(Schema.String)),
  optional_host_permissions: Schema.optional(Schema.Array(Schema.String)),
  content_scripts: Schema.optional(
    Schema.Array(Schema.Struct({ matches: Schema.optional(Schema.Array(Schema.String)) })),
  ),
  externally_connectable: Schema.optional(Schema.Struct({ matches: Schema.optional(Schema.Array(Schema.String)) })),
  web_accessible_resources: Schema.optional(
    Schema.Array(Schema.Struct({ matches: Schema.optional(Schema.Array(Schema.String)) })),
  ),
});
type Manifest = typeof Manifest.Type;
const decodeManifest = Schema.decodeUnknownSync(Schema.fromJsonString(Manifest));

const ServiceAccountKey = Schema.Struct({
  client_email: Schema.String,
  private_key: Schema.String,
  token_uri: Schema.optional(Schema.String),
});
const decodeServiceAccountKey = Schema.decodeUnknownSync(Schema.fromJsonString(ServiceAccountKey));

const decodeJson = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Unknown));
const decodeJsonOption = (text: string) =>
  Option.getOrUndefined(Schema.decodeUnknownOption(Schema.fromJsonString(Schema.Unknown))(text));

const decodeAccessToken = Schema.decodeUnknownSync(Schema.Struct({ access_token: Schema.String }));

const RevisionStatus = Schema.Struct({
  state: Schema.optional(Schema.String),
  distributionChannels: Schema.optional(Schema.Array(Schema.Struct({ crxVersion: Schema.optional(Schema.String) }))),
});
type RevisionStatus = typeof RevisionStatus.Type;
const decodeItemStatus = Schema.decodeUnknownSync(
  Schema.Struct({
    publishedItemRevisionStatus: Schema.optional(RevisionStatus),
    submittedItemRevisionStatus: Schema.optional(RevisionStatus),
    lastAsyncUploadState: Schema.optional(Schema.String),
    takenDown: Schema.optional(Schema.Boolean),
  }),
);
type ItemStatus = ReturnType<typeof decodeItemStatus>;

const decodeUpload = Schema.decodeUnknownSync(
  Schema.Struct({ uploadState: Schema.optional(Schema.String), crxVersion: Schema.optional(Schema.String) }),
);

const decodePublish = Schema.decodeUnknownSync(
  Schema.Struct({
    state: Schema.optional(Schema.String),
    warningInfo: Schema.optional(
      Schema.Struct({
        warnings: Schema.optional(
          Schema.Array(
            Schema.Struct({ reason: Schema.optional(Schema.String), description: Schema.optional(Schema.String) }),
          ),
        ),
      }),
    ),
  }),
);

const decodeGoogleError = Schema.decodeUnknownOption(
  Schema.Struct({
    error: Schema.Struct({ message: Schema.optional(Schema.String), status: Schema.optional(Schema.String) }),
  }),
);

interface Options {
  command: "check" | "publish";
  zipPath: string;
  allowNewPermissions: boolean;
  replacePending: boolean;
}

function out(text: string): void {
  process.stdout.write(`${text}\n`);
}

function warn(lines: string[]): void {
  out(`::warning title=Chrome Web Store::${lines[0] ?? ""}`);
  summarize(lines);
}

function summarize(lines: string[]): void {
  out(lines.join("\n"));
  const summary = process.env.GITHUB_STEP_SUMMARY;
  if (summary) appendFileSync(summary, `${lines.join("\n")}\n`);
}

function parseOptions(argv: string[]): Options {
  const [command, zipPath, ...flags] = argv;
  if ((command !== "check" && command !== "publish") || !zipPath)
    throw new ReleaseStop(
      "Usage: bun scripts/chrome-web-store-release.ts check|publish <zip> [--allow-new-permissions] [--replace-pending]",
    );
  const known = new Set(["--allow-new-permissions", "--replace-pending"]);
  const unknown = flags.filter((flag) => !known.has(flag));
  if (unknown.length > 0) throw new ReleaseStop(`Unknown option: ${unknown.join(" ")}`);
  return {
    command,
    zipPath,
    allowNewPermissions: flags.includes("--allow-new-permissions"),
    replacePending: flags.includes("--replace-pending"),
  };
}

function compareVersions(left: string, right: string): number {
  const parts = (version: string) => version.split(".").map((part) => Number.parseInt(part, 10) || 0);
  const [a, b] = [parts(left), parts(right)];
  for (let index = 0; index < Math.max(a.length, b.length); index += 1) {
    const difference = (a[index] ?? 0) - (b[index] ?? 0);
    if (difference !== 0) return Math.sign(difference);
  }
  return 0;
}

async function zipEntries(zipPath: string): Promise<string[]> {
  const { stdout } = await run("unzip", ["-Z1", zipPath], { maxBuffer: 16 * 1024 * 1024 });
  return stdout.split("\n").filter((line) => line.length > 0);
}

async function zipManifest(zipPath: string): Promise<Manifest> {
  const { stdout } = await run("unzip", ["-p", zipPath, "manifest.json"], { maxBuffer: 16 * 1024 * 1024 });
  return decodeManifest(stdout);
}

async function rootPackageVersion(): Promise<string> {
  const text = await readFile(new URL("../package.json", import.meta.url), "utf8");
  return Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ version: Schema.String })))(text).version;
}

async function checkPackage(zipPath: string): Promise<Manifest> {
  const entries = await zipEntries(zipPath);
  if (!entries.includes("manifest.json")) throw new ReleaseStop(`${zipPath} has no manifest.json at the top level.`);
  const sourceMaps = entries.filter((entry) => entry.endsWith(".map"));
  if (sourceMaps.length > 0) throw new ReleaseStop(`The package has source maps: ${sourceMaps.join(", ")}`);
  const manifest = await zipManifest(zipPath);
  if (manifest.name !== EXTENSION_NAME)
    throw new ReleaseStop(
      `The manifest name is "${manifest.name}", not "${EXTENSION_NAME}". Is it a development build?`,
    );
  const manifestText = JSON.stringify(manifest);
  if (manifestText.includes("localhost") || manifestText.includes("127.0.0.1"))
    throw new ReleaseStop("The manifest names localhost or 127.0.0.1. Is it a development build?");
  const packageVersion = await rootPackageVersion();
  if (manifest.version !== packageVersion)
    throw new ReleaseStop(
      `The manifest version ${manifest.version} is not the package.json version ${packageVersion}.`,
    );
  if (process.env.GITHUB_REF_TYPE === "tag" && process.env.GITHUB_REF_NAME !== `v${manifest.version}`)
    throw new ReleaseStop(`The tag ${process.env.GITHUB_REF_NAME} is not v${manifest.version}.`);
  return manifest;
}

async function publicManifest(): Promise<Manifest> {
  const response = await fetch(PUBLIC_PACKAGE_URL, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  if (!response.ok) throw new Error(`The public package download failed with HTTP ${response.status}.`);
  const crx = Buffer.from(await response.arrayBuffer());
  if (crx.length === 0)
    throw new Error(`The public package download gave no package (HTTP ${response.status}). No permission comparison.`);
  if (crx.subarray(0, 4).toString("latin1") !== "Cr24" || crx.readUInt32LE(4) !== 3)
    throw new Error("The public package is not a CRX3 file.");
  const zipStart = 12 + crx.readUInt32LE(8);
  const directory = await mkdtemp(join(tmpdir(), "openbot-public-extension-"));
  try {
    const zipPath = join(directory, "public.zip");
    await writeFile(zipPath, crx.subarray(zipStart));
    return await zipManifest(zipPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

function accessPatterns(manifest: Manifest): Map<string, Set<string>> {
  return new Map([
    ["permissions", new Set(manifest.permissions)],
    ["optional_permissions", new Set(manifest.optional_permissions)],
    ["host_permissions", new Set(manifest.host_permissions)],
    ["optional_host_permissions", new Set(manifest.optional_host_permissions)],
    ["content_scripts.matches", new Set(manifest.content_scripts?.flatMap((script) => script.matches ?? []))],
    ["externally_connectable.matches", new Set(manifest.externally_connectable?.matches)],
    [
      "web_accessible_resources.matches",
      new Set(manifest.web_accessible_resources?.flatMap((resource) => resource.matches ?? [])),
    ],
  ]);
}

function addedAccess(previous: Manifest, next: Manifest): string[] {
  const before = accessPatterns(previous);
  return [...accessPatterns(next)].flatMap(([field, values]) =>
    [...values].filter((value) => !before.get(field)?.has(value)).map((value) => `${field}: ${value}`),
  );
}

async function checkAgainstPublic(manifest: Manifest, options: Options): Promise<void> {
  const published = await publicManifest();
  if (compareVersions(manifest.version, published.version) <= 0) {
    summarize([`The public version is ${published.version}. This package (${manifest.version}) is not newer.`]);
    return;
  }
  const added = addedAccess(published, manifest);
  if (added.length === 0) {
    summarize([`Permissions, hosts and match patterns are the same as or fewer than public ${published.version}.`]);
    return;
  }
  const lines = [
    `Version ${manifest.version} asks for access that public ${published.version} does not have:`,
    ...added.map((entry) => `- \`${entry}\``),
  ];
  if (options.allowNewPermissions) {
    summarize([...lines, "", "Allowed by --allow-new-permissions."]);
    return;
  }
  summarize([
    ...lines,
    "",
    "Chrome can disable the extension for every user until each user accepts a new permission warning.",
    "Confirm the change, then run the workflow by hand on the tag with `allow_new_permissions`.",
  ]);
  throw new ReleaseStop("New permissions need confirmation.");
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value).toString("base64url");
}

async function accessToken(): Promise<string> {
  const keyText = process.env.CHROME_WEB_STORE_SERVICE_ACCOUNT_KEY;
  if (!keyText) throw new ReleaseStop("Set CHROME_WEB_STORE_SERVICE_ACCOUNT_KEY to the service account JSON key.");
  const key = decodeServiceAccountKey(keyText);
  const tokenUri = key.token_uri ?? "https://oauth2.googleapis.com/token";
  const issuedAt = Math.floor(Date.now() / 1000);
  const unsigned = `${base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }))}.${base64Url(
    JSON.stringify({ iss: key.client_email, scope: STORE_SCOPE, aud: tokenUri, iat: issuedAt, exp: issuedAt + 3600 }),
  )}`;
  const signature = createSign("RSA-SHA256").update(unsigned).sign(key.private_key);
  const response = await fetch(tokenUri, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${unsigned}.${base64Url(signature)}`,
    }),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) throw new Error(`The Google token request failed with HTTP ${response.status}.`);
  return decodeAccessToken(await response.json()).access_token;
}

class StoreClient {
  readonly #token: string;
  readonly #item: string;

  constructor(token: string, publisherId: string) {
    this.#token = token;
    this.#item = `publishers/${encodeURIComponent(publisherId)}/items/${EXTENSION_ID}`;
  }

  async #request(method: string, url: string, body?: BodyInit, contentType?: string): Promise<unknown> {
    const headers: Record<string, string> = { authorization: `Bearer ${this.#token}` };
    if (contentType) headers["content-type"] = contentType;
    const response = await fetch(url, { method, headers, body, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    const text = await response.text();
    if (!response.ok) {
      const error = decodeGoogleError(decodeJsonOption(text));
      const detail = Option.isSome(error) ? `${error.value.error.status ?? ""} ${error.value.error.message ?? ""}` : "";
      throw new Error(`${method} ${new URL(url).pathname} failed with HTTP ${response.status}. ${detail}`.trim());
    }
    return decodeJson(text.length > 0 ? text : "{}");
  }

  async status(): Promise<ItemStatus> {
    return decodeItemStatus(await this.#request("GET", `${STORE_API}/v2/${this.#item}:fetchStatus`));
  }

  async cancelSubmission(): Promise<void> {
    await this.#request("POST", `${STORE_API}/v2/${this.#item}:cancelSubmission`);
  }

  async upload(zip: Buffer): Promise<ReturnType<typeof decodeUpload>> {
    return decodeUpload(
      await this.#request(
        "POST",
        `${STORE_API}/upload/v2/${this.#item}:upload`,
        new Uint8Array(zip),
        "application/zip",
      ),
    );
  }

  async publish(): Promise<ReturnType<typeof decodePublish>> {
    return decodePublish(
      await this.#request(
        "POST",
        `${STORE_API}/v2/${this.#item}:publish`,
        JSON.stringify({ publishType: "DEFAULT_PUBLISH" }),
        "application/json",
      ),
    );
  }
}

function revisionVersion(revision: RevisionStatus | undefined): string | undefined {
  return revision?.distributionChannels?.find((channel) => channel.crxVersion)?.crxVersion;
}

async function waitForUpload(client: StoreClient): Promise<void> {
  const deadline = Date.now() + UPLOAD_DEADLINE_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, UPLOAD_POLL_INTERVAL_MS));
    const state = (await client.status()).lastAsyncUploadState;
    if (state === "SUCCEEDED") return;
    if (state !== "IN_PROGRESS") throw new Error(`The store upload ended in state ${state ?? "unknown"}.`);
  }
  throw new Error("The store upload did not finish in 10 minutes.");
}

type SubmissionPlan = "upload" | "done" | "skip";

async function planSubmission(client: StoreClient, version: string, options: Options): Promise<SubmissionPlan> {
  const status = await client.status();
  if (status.takenDown) throw new ReleaseStop("The store took the item down. Fix it in the Developer Dashboard.");
  const publishedVersion = revisionVersion(status.publishedItemRevisionStatus);
  const submitted = status.submittedItemRevisionStatus;
  const submittedVersion = revisionVersion(submitted);
  out(
    `Store: published ${publishedVersion ?? "none"}, submitted ${submittedVersion ?? "none"} (${submitted?.state ?? "none"}).`,
  );
  const newest = [publishedVersion, submittedVersion]
    .filter((candidate): candidate is string => candidate !== undefined)
    .sort(compareVersions)
    .at(-1);
  if (newest === version) {
    summarize([`The store already has version ${version}. Nothing to upload.`]);
    return "done";
  }
  if (newest && compareVersions(newest, version) > 0) {
    warn([`The store has version ${newest}, which is newer than ${version}. Nothing to upload.`]);
    return "skip";
  }
  if (submitted?.state === "PENDING_REVIEW") {
    if (!options.replacePending) {
      warn([
        `Version ${submittedVersion ?? "unknown"} is in review. Version ${version} was not uploaded.`,
        "The next release uploads after the review. To replace the version in review now, run the workflow by hand on the tag with `replace_pending`.",
      ]);
      return "skip";
    }
    await client.cancelSubmission();
    out(`Cancelled the review of version ${submittedVersion ?? "unknown"}.`);
  }
  return "upload";
}

async function publish(manifest: Manifest, options: Options): Promise<void> {
  const publisherId = process.env.CHROME_WEB_STORE_PUBLISHER_ID;
  if (!publisherId) throw new ReleaseStop("Set CHROME_WEB_STORE_PUBLISHER_ID.");
  const client = new StoreClient(await accessToken(), publisherId);
  if ((await planSubmission(client, manifest.version, options)) !== "upload") return;
  const upload = await client.upload(await readFile(options.zipPath));
  if (upload.uploadState === "IN_PROGRESS") await waitForUpload(client);
  else if (upload.uploadState !== "SUCCEEDED")
    throw new Error(`The store upload ended in state ${upload.uploadState ?? "unknown"}.`);
  if (upload.crxVersion && upload.crxVersion !== manifest.version)
    throw new Error(`The store read version ${upload.crxVersion}, not ${manifest.version}.`);
  const result = await client.publish();
  const warnings = result.warningInfo?.warnings ?? [];
  summarize([
    `Submitted OpenBot extension ${manifest.version} to the Chrome Web Store (state ${result.state ?? "unknown"}).`,
    "The store publishes it to all users when the review passes. Chrome then updates each install within a few hours.",
    ...warnings.map((warning) => `- Warning ${warning.reason ?? ""}: ${warning.description ?? ""}`),
  ]);
}

async function main(): Promise<void> {
  const options = parseOptions(process.argv.slice(2));
  const manifest = await checkPackage(options.zipPath);
  out(`Package ${options.zipPath}: ${manifest.name} ${manifest.version}.`);
  await checkAgainstPublic(manifest, options);
  if (options.command === "publish") await publish(manifest, options);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
