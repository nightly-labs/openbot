import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createOpenBotLogger } from "@openbot/logging";
import { z } from "zod";
import { type AgentRuntimeLock, loadAgentRuntimeLock } from "./agent-runtime-lock";
import { rejectNonRegularFiles, sha256 } from "./remote-desktop-runtime-release";
import { escapeRegExp, installValidatedTree, isCurrentInstallation, safeArchivePathParts } from "./runtime-install";

const logger = createOpenBotLogger("install-codex-runtime");

export type CodexRuntimeTarget = "darwin-arm64" | "darwin-x64" | "linux-x64" | "linux-arm64" | "win32-x64";

const packageManifestSchema = z.object({
  layoutVersion: z.literal(1),
  version: z.string(),
  target: z.enum([
    "aarch64-apple-darwin",
    "x86_64-apple-darwin",
    "x86_64-pc-windows-msvc",
    "x86_64-unknown-linux-musl",
    "aarch64-unknown-linux-musl",
  ]),
  variant: z.literal("codex"),
  entrypoint: z.string(),
  resourcesDir: z.literal("codex-resources"),
  pathDir: z.literal("codex-path"),
});

export async function installCodexRuntime(
  input: {
    sourceRoot?: string;
    outputRoot?: string;
    target?: CodexRuntimeTarget;
    fetchImpl?: typeof fetch;
    lock?: AgentRuntimeLock;
  } = {},
): Promise<"installed" | "current"> {
  const sourceRoot = input.sourceRoot ?? process.cwd();
  const outputRoot = input.outputRoot ?? resolve(sourceRoot, "build/codex");
  const target = input.target ?? codexRuntimeTarget();
  const fetchImpl = input.fetchImpl ?? fetch;
  const lock = input.lock ?? (await loadAgentRuntimeLock(sourceRoot));
  const artifact = lock.codex.artifacts[target];
  const targetRoot = codexRuntimePath(outputRoot, target);

  if (await isCurrentInstallation(() => verifyCodexRuntime(targetRoot, target, lock))) {
    await writeMetadata(outputRoot, lock, fetchImpl);
    logger.info(`Using verified bundled Codex ${lock.codex.version} for ${target}.`);
    return "current";
  }

  const response = await fetchImpl(
    `${lock.codex.repository}/releases/download/${encodeURIComponent(lock.codex.tag)}/${artifact.asset}`,
    { headers: { "User-Agent": "OpenBot-runtime-installer" }, redirect: "follow" },
  );
  if (!response.ok) throw new Error(`Codex runtime download failed with HTTP ${response.status}.`);
  const archiveBytes = Buffer.from(await response.arrayBuffer());
  if (sha256(archiveBytes) !== artifact.assetSha256) {
    throw new Error(`The ${target} Codex runtime archive checksum is invalid.`);
  }

  const temporaryRoot = await mkdtemp(join(tmpdir(), "openbot-codex-install-"));
  try {
    const archive = join(temporaryRoot, artifact.asset);
    const extracted = join(temporaryRoot, "extracted");
    await writeFile(archive, archiveBytes, { mode: 0o600 });
    validateCodexArchive(archive);
    await mkdir(extracted, { recursive: true });
    execFileSync("tar", ["-xzf", archive, "-C", extracted, "--no-same-owner"], { stdio: "inherit" });
    await rejectNonRegularFiles(extracted);
    await verifyCodexRuntime(extracted, target, lock);
    await installValidatedTree(extracted, targetRoot);
    await verifyCodexRuntime(targetRoot, target, lock);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }

  await writeMetadata(outputRoot, lock, fetchImpl);
  logger.info(`Installed bundled Codex ${lock.codex.version} for ${target}.`);
  return "installed";
}

/** The `target` the Codex package manifest carries for each runtime target OpenBot ships. */
const CODEX_MANIFEST_TARGETS = {
  "darwin-arm64": "aarch64-apple-darwin",
  "darwin-x64": "x86_64-apple-darwin",
  "linux-x64": "x86_64-unknown-linux-musl",
  "linux-arm64": "aarch64-unknown-linux-musl",
  "win32-x64": "x86_64-pc-windows-msvc",
} as const satisfies Record<CodexRuntimeTarget, string>;

export function codexRuntimeTarget(
  platform: string = process.platform,
  architecture: string = process.arch,
): CodexRuntimeTarget {
  const target = `${platform}-${architecture}`;
  if (
    target === "darwin-arm64" ||
    target === "darwin-x64" ||
    target === "linux-x64" ||
    target === "linux-arm64" ||
    target === "win32-x64"
  )
    return target;
  throw new Error(`Unsupported bundled Codex target: ${target}`);
}

export function codexRuntimePath(root: string, target: CodexRuntimeTarget): string {
  if (target === "darwin-arm64") return join(root, "mac", "arm64");
  if (target === "darwin-x64") return join(root, "mac", "x64");
  if (target === "linux-x64") return join(root, "linux", "x64");
  if (target === "linux-arm64") return join(root, "linux", "arm64");
  return join(root, "win", "x64");
}

export async function verifyCodexRuntime(
  root: string,
  target: CodexRuntimeTarget,
  lock: AgentRuntimeLock,
): Promise<void> {
  const artifact = lock.codex.artifacts[target];
  const manifest = packageManifestSchema.parse(JSON.parse(await readFile(join(root, "codex-package.json"), "utf8")));
  const expectedTarget = CODEX_MANIFEST_TARGETS[target];
  if (
    manifest.version !== lock.codex.version ||
    manifest.target !== expectedTarget ||
    manifest.entrypoint !== artifact.executable
  ) {
    throw new Error("The bundled Codex package manifest does not match the runtime lock.");
  }
  const executable = join(root, ...artifact.executable.split("/"));
  const output = execFileSync(executable, ["--version"], { encoding: "utf8", windowsHide: true }).trim();
  if (!new RegExp(`(?:codex-cli\\s+)?${escapeRegExp(lock.codex.version)}(?:\\s|$)`, "u").test(output)) {
    throw new Error(`Unexpected bundled Codex version: ${output}`);
  }
  await readFile(join(root, "bin", target === "win32-x64" ? "codex-code-mode-host.exe" : "codex-code-mode-host"));
  await readFile(join(root, "codex-path", target === "win32-x64" ? "rg.exe" : "rg"));
}

export function validateCodexArchive(archive: string): string[] {
  const names = execFileSync("tar", ["-tzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  const details = execFileSync("tar", ["-tvzf", archive], { encoding: "utf8" }).split(/\r?\n/u).filter(Boolean);
  if (details.some((line) => !["-", "d"].includes(line.trimStart().charAt(0)))) {
    throw new Error("The Codex runtime archive contains a link or a special file.");
  }
  for (const name of names) validateArchivePath(name);
  if (!names.includes("codex-package.json") || !names.some((name) => /^bin\/codex(?:\.exe)?$/u.test(name))) {
    throw new Error("The Codex runtime archive is incomplete.");
  }
  return names;
}

function validateArchivePath(name: string): void {
  const parts = safeArchivePathParts(name, "Codex");
  if (!["bin", "codex-package.json", "codex-path", "codex-resources"].includes(parts[0] ?? "")) {
    throw new Error(`Unexpected Codex archive path: ${name}`);
  }
}

async function writeMetadata(root: string, lock: AgentRuntimeLock, fetchImpl: typeof fetch): Promise<void> {
  const licenseRoot = join(root, "licenses");
  const licensePath = join(licenseRoot, "Codex-Apache-2.0.txt");
  await mkdir(licenseRoot, { recursive: true });
  let currentLicense: string | null = null;
  try {
    currentLicense = sha256(await readFile(licensePath));
  } catch {
    // Download the pinned license below.
  }
  if (currentLicense !== lock.codex.licenseSha256) {
    const response = await fetchImpl(`${lock.codex.repository}/raw/${encodeURIComponent(lock.codex.tag)}/LICENSE`, {
      headers: { "User-Agent": "OpenBot-runtime-installer" },
      redirect: "follow",
    });
    if (!response.ok) throw new Error(`Codex license download failed with HTTP ${response.status}.`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (sha256(bytes) !== lock.codex.licenseSha256) throw new Error("The Codex license checksum is invalid.");
    await writeFile(licensePath, bytes);
  }
  await writeFile(join(root, "source-manifest.json"), `${JSON.stringify({ name: "codex", ...lock.codex }, null, 2)}\n`);
}

if (import.meta.main) {
  await installCodexRuntime({
    target: codexRuntimeTarget(process.argv[2] ?? process.platform, process.argv[3] ?? process.arch),
  });
}
