import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { chmod, copyFile, mkdir, readdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import { promisify } from "node:util";
import type { AcpRegistryDistribution } from "@openbot/contracts/ipc";
import { isDynamicRecord, isString } from "@openbot/contracts/runtime-values";
import { sourceText } from "@openbot/i18n/source";
import { Effect } from "effect";
import { checkAcpAgent } from "../backend/acp-agent-check";
import { assertAgentArgs, assertWindowsScriptArgs, resolveAgentCommand } from "../backend/acp-agent-command";
import { type RegistryAgent, registryDownload } from "./acp-registry-catalog";
import { runRegistryInstaller } from "./acp-registry-process";
import { assertSafeArchive, extractArchive, extractZipTree, rejectNonRegularFiles } from "./provider-runtime-archive";
import { ProviderRuntimeFailure, runtimeIO, runtimeSync, toProviderRuntimeFailure } from "./provider-runtime-effects";

const execFileAsync = promisify(execFile);
export function registryTarget(platform = process.platform, arch = process.arch): string {
  return `${platform === "win32" ? "windows" : platform}-${arch === "arm64" ? "aarch64" : arch === "x64" ? "x86_64" : arch}`;
}
export function registryDistributions(agent: RegistryAgent): AcpRegistryDistribution[] {
  return [
    ...(agent.distribution.binary?.[registryTarget()] ? ["binary" as const] : []),
    ...(agent.distribution.npx ? ["npx" as const] : []),
    ...(agent.distribution.uvx ? ["uvx" as const] : []),
  ];
}
export interface RegistryPrepared {
  command: string;
  args: string[];
  env: Record<string, string>;
}

/** Rejects paths before archive or package metadata can select an executable. */
export function registryRelativePath(value: string): string {
  const path = value.replace(/^\.\//u, "");
  if (
    !path ||
    isAbsolute(path) ||
    /^[A-Za-z]:/u.test(path) ||
    path.includes("\\") ||
    path.includes("\0") ||
    path.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new Error(sourceText("error.provider.nativeArchiveInvalid"));
  return path;
}

const packageCommand = Effect.fn("AcpRegistry.packageCommand")(function* (
  command: string,
  args: string[],
  cwd: string,
  env: Record<string, string>,
) {
  const executable = yield* resolveAgentCommand(command).pipe(toProviderRuntimeFailure);
  if (!executable)
    return yield* new ProviderRuntimeFailure({
      cause: new Error(sourceText("error.provider.registryPrerequisite", { tool: command })),
    });
  yield* runRegistryInstaller(executable, args, cwd, env);
});

/** Stages in a unique permanent path: uv's virtual environments cannot be moved after installation. */
export const prepareRegistryAgent = Effect.fn("AcpRegistry.prepare")(function* (
  agent: RegistryAgent,
  distribution: AcpRegistryDistribution,
  folder: string,
) {
  const payload = join(folder, "runtime");
  yield* runtimeIO(() => mkdir(payload, { recursive: true, mode: 0o700 }));
  let prepared: RegistryPrepared;
  if (distribution === "binary") {
    const target = agent.distribution.binary?.[registryTarget()];
    if (!target)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryMissing")) });
    const commandPath = yield* runtimeSync(() => registryRelativePath(target.cmd));
    const bytes = yield* registryDownload(target.archive, 512 * 1024 * 1024);
    if (target.sha256 && createHash("sha256").update(bytes).digest("hex") !== target.sha256.toLowerCase())
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeChecksum")) });
    const archive = join(folder, "download");
    yield* runtimeIO(() => writeFile(archive, bytes, { mode: 0o600 }));
    const pathname = new URL(target.archive).pathname;
    if (pathname.endsWith(".zip"))
      yield* extractZipTree(archive, payload, "", sourceText("error.provider.nativeArchiveInvalid"));
    else if (pathname.endsWith(".tar.gz") || pathname.endsWith(".tgz")) {
      const listing = yield* runtimeIO((signal) =>
        execFileAsync("tar", ["-tzf", archive], { signal, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }),
      );
      const roots = listing.stdout
        .split(/\r?\n/u)
        .filter(Boolean)
        .map((name) => name.split("/")[0] ?? "");
      yield* assertSafeArchive(archive, roots, sourceText("error.provider.nativeArchiveInvalid"));
      yield* extractArchive(archive, payload);
    } else {
      const command = join(payload, commandPath);
      yield* runtimeIO(() => mkdir(resolve(command, ".."), { recursive: true }));
      yield* runtimeIO(() => copyFile(archive, command));
    }
    yield* rejectNonRegularFiles(payload);
    prepared = { command: join(payload, commandPath), args: [...(target.args ?? [])], env: { ...target.env } };
    if (process.platform !== "win32") yield* runtimeIO(() => chmod(prepared.command, 0o755));
  } else if (distribution === "npx") {
    const target = agent.distribution.npx;
    if (!target)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryMissing")) });
    yield* packageCommand(
      "npm",
      ["install", "--prefix", payload, "--omit=dev", "--no-audit", "--no-fund", "--save-exact", target.package],
      folder,
      {},
    );
    const name = target.package.slice(0, target.package.lastIndexOf("@"));
    const manifest = yield* runtimeIO(async () =>
      JSON.parse(await readFile(join(payload, "node_modules", name, "package.json"), "utf8")),
    );
    const bin = isDynamicRecord(manifest) ? manifest.bin : undefined;
    const bins = isString(bin) ? { [basename(name)]: bin } : isDynamicRecord(bin) ? bin : {};
    const entries = Object.entries(bins).filter((pair): pair is [string, string] => isString(pair[1]));
    const selected = entries.find(([key]) => key === basename(name)) ?? (entries.length === 1 ? entries[0] : undefined);
    if (!selected)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    yield* runtimeSync(() => registryRelativePath(selected[1]));
    const binName = yield* runtimeSync(() => registryRelativePath(selected[0]));
    if (binName.includes("/"))
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    prepared = {
      command: join(payload, "node_modules", ".bin", `${binName}${process.platform === "win32" ? ".cmd" : ""}`),
      args: [...(target.args ?? [])],
      env: { ...target.env },
    };
  } else {
    const target = agent.distribution.uvx;
    if (!target)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.registryMissing")) });
    const binDirectory = join(payload, "bin");
    const env = { UV_TOOL_DIR: join(payload, "tools"), UV_TOOL_BIN_DIR: binDirectory };
    yield* packageCommand(
      "uv",
      ["tool", "install", "--no-progress", "--no-managed-python", target.package.replace(/@(?=v?\d)/u, "==")],
      folder,
      env,
    );
    const names = yield* runtimeIO(() => readdir(binDirectory));
    const packageName = target.package.split(/@|==/u)[0];
    const wanted = `${packageName}${process.platform === "win32" ? ".exe" : ""}`;
    const name = names.includes(wanted) ? wanted : names.length === 1 ? names[0] : undefined;
    if (!name)
      return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
    prepared = { command: join(binDirectory, name), args: [...(target.args ?? [])], env: { ...target.env } };
  }
  const executable = yield* runtimeIO(() => realpath(prepared.command));
  const within = relative(payload, executable);
  if (within.startsWith("..") || isAbsolute(within) || !(yield* runtimeIO(() => stat(executable))).isFile())
    return yield* new ProviderRuntimeFailure({ cause: new Error(sourceText("error.provider.nativeArchiveInvalid")) });
  yield* runtimeSync(() => {
    assertAgentArgs(prepared.args);
    assertWindowsScriptArgs(prepared.command, prepared.args);
  });
  yield* checkAcpAgent({ executable: prepared.command, args: prepared.args, env: prepared.env }).pipe(
    toProviderRuntimeFailure,
  );
  return prepared;
});
