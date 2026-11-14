// Writes the Umbrel app of one OpenBot release (docs/umbrel.md) from the templates in docker/umbrel/openbot.
// It pins the image to the digest of the multi-architecture index on GHCR, as the Umbrel app store requires,
// and copies the seccomp profile of the image into the app folder.
//
//   bun scripts/umbrel-app.ts --version <x.y.z> [--id=<app id>] [--out=<folder>]
//   bun scripts/umbrel-app.ts --version <x.y.z> --official [--submission=<pull request URL>]
//
// The app id is `openbot` by default. In a community app store, it must start with the id of the store,
// such as `openbot-server`, and the manifest has an icon. `--official` writes the app of the official
// Umbrel App Store: the id `openbot` and no icon, because Umbrel keeps the icons of that store in
// another repository. `--submission` is the URL of the pull request to that store. The default folder
// is .openbot-build/umbrel/<app id>. Copy it to the app store as a folder with the name of the app id.
import { chmodSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { Schema } from "effect";

const logger = createOpenBotLogger("umbrel-app");
const ROOT = resolve(import.meta.dirname, "..");
const TEMPLATE = join(ROOT, "docker/umbrel/openbot");
const IMAGE = "nightly-labs/openbot";
const decodePullToken = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ token: Schema.String })));
const INDEX_TYPES = [
  "application/vnd.oci.image.index.v1+json",
  "application/vnd.docker.distribution.manifest.list.v2+json",
];

const version = argument("version");
if (!version || !/^\d+\.\d+\.\d+$/u.test(version)) {
  throw new Error("Give the release as --version <x.y.z>.");
}
const official = process.argv.includes("--official");
const appId = argument("id") ?? "openbot";
if (official && appId !== "openbot") throw new Error("The official app has the id openbot. Remove --id.");
const submission = argument("submission") ?? "";
if (submission && !/^https:\/\/github\.com\/getumbrel\/umbrel-apps\/pull\/\d+$/u.test(submission)) {
  throw new Error("Give --submission as the URL of a pull request to getumbrel/umbrel-apps.");
}
if (!/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u.test(appId)) {
  throw new Error("Give the app id as lowercase letters, digits and dashes, such as --id openbot-server.");
}
const out = resolve(ROOT, argument("out") ?? `.openbot-build/umbrel/${appId}`);

// The folder is replaced. Only an empty folder or an earlier app folder can be replaced, never the repository.
const notAppFolder = existsSync(out) && readdirSync(out).length > 0 && !existsSync(join(out, "umbrel-app.yml"));
if (out === TEMPLATE || notAppFolder) {
  throw new Error(`${out} is not an Umbrel app folder. Give an empty or new folder as --out.`);
}
const digest = await indexDigest(version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "hooks"), { recursive: true });
for (const file of ["umbrel-app.yml", "docker-compose.yml"]) {
  let text = readFileSync(join(TEMPLATE, file), "utf8")
    .replaceAll("__APP_ID__", appId)
    .replaceAll("__VERSION__", version)
    .replaceAll("__DIGEST__", digest);
  if (file === "umbrel-app.yml") {
    if (official) text = text.replace(/^icon: .*\n/mu, "");
    if (submission) text = text.replace(/^submission: ""$/mu, `submission: ${submission}`);
  }
  writeFileSync(join(out, file), text);
}
// Umbrel needs the source folder of each bind mount in the package.
cpSync(join(TEMPLATE, "data"), join(out, "data"), { recursive: true });
cpSync(join(TEMPLATE, "hooks/pre-start"), join(out, "hooks/pre-start"));
chmodSync(join(out, "hooks/pre-start"), 0o755);
cpSync(join(ROOT, "docker/seccomp.json"), join(out, "seccomp.json"));
logger.info(`Wrote the Umbrel app ${appId} of ${version} (${digest}) to ${out}.`);

/** The digest of the image index of a release tag. Public images need no sign-in: GHCR gives an anonymous token. */
async function indexDigest(tag: string): Promise<string> {
  const tokenResponse = await fetch(`https://ghcr.io/token?scope=repository:${IMAGE}:pull`);
  if (!tokenResponse.ok) throw new Error(`GHCR did not give a pull token (${tokenResponse.status}).`);
  const { token } = decodePullToken(await tokenResponse.text());
  const response = await fetch(`https://ghcr.io/v2/${IMAGE}/manifests/${tag}`, {
    method: "HEAD",
    headers: { authorization: `Bearer ${token}`, accept: INDEX_TYPES.join(", ") },
  });
  if (!response.ok) throw new Error(`GHCR has no image ${IMAGE}:${tag} (${response.status}).`);
  const type = response.headers.get("content-type") ?? "";
  if (!INDEX_TYPES.includes(type)) {
    throw new Error(`${IMAGE}:${tag} is ${type}, not a multi-architecture index. Umbrel runs on amd64 and arm64.`);
  }
  const value = response.headers.get("docker-content-digest") ?? "";
  if (!/^sha256:[0-9a-f]{64}$/u.test(value)) throw new Error(`GHCR gave no digest for ${IMAGE}:${tag}.`);
  return value;
}

function argument(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index !== -1) return process.argv[index + 1];
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}
