// Writes the Umbrel app of one OpenBot release (docs/umbrel.md) from the templates in docker/umbrel/openbot.
// It pins the image to the digest of the multi-architecture index on GHCR, as the Umbrel app store requires,
// and copies the seccomp profile of the image into the app folder.
//
//   bun scripts/umbrel-app.ts --version <x.y.z> [--out=<folder>]
//
// The default folder is .openbot-build/umbrel/openbot. Copy it to an Umbrel app store as `openbot`.
import { chmodSync, cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
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
const out = resolve(ROOT, argument("out") ?? ".openbot-build/umbrel/openbot");

const digest = await indexDigest(version);
rmSync(out, { recursive: true, force: true });
mkdirSync(join(out, "hooks"), { recursive: true });
for (const file of ["umbrel-app.yml", "docker-compose.yml"]) {
  const text = readFileSync(join(TEMPLATE, file), "utf8")
    .replaceAll("__VERSION__", version)
    .replaceAll("__DIGEST__", digest);
  writeFileSync(join(out, file), text);
}
cpSync(join(TEMPLATE, "hooks/pre-start"), join(out, "hooks/pre-start"));
chmodSync(join(out, "hooks/pre-start"), 0o755);
cpSync(join(ROOT, "docker/seccomp.json"), join(out, "seccomp.json"));
logger.info(`Wrote the Umbrel app of ${version} (${digest}) to ${out}.`);

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
