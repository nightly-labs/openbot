import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "Must use a complete SHA-256 value.");
const codexArtifactSchema = z.object({
  asset: z.string().min(1),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.string().regex(/^bin\/codex(?:\.exe)?$/u),
});
const claudeArtifactSchema = z.object({
  package: z.string().regex(/^@anthropic-ai\/claude-agent-sdk-(?:darwin-arm64|linux-x64|linux-arm64|win32-x64)$/u),
  asset: z.string().regex(/^claude-agent-sdk-(?:darwin-arm64|linux-x64|linux-arm64|win32-x64)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["claude", "claude.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});
const opencodeArtifactSchema = z.object({
  package: z.string().regex(/^opencode-(?:darwin-arm64|linux-x64|linux-arm64|windows-x64)$/u),
  asset: z.string().regex(/^opencode-(?:darwin-arm64|linux-x64|linux-arm64|windows-x64)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["opencode", "opencode.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});
/**
 * Bun ships one npm package per target and no `bunx` of its own, so the staged layout makes that
 * name itself. `baseline` on x64: Bun's plain x64 builds need AVX2, and a machine older than that
 * would answer a spawn with an illegal instruction and no message. The baseline build starts
 * slightly slower, which is nothing against launching one MCP server.
 */
const bunArtifactSchema = z.object({
  package: z.string().regex(/^@oven\/bun-(?:darwin-aarch64|linux-x64-baseline|linux-aarch64|windows-x64-baseline)$/u),
  asset: z
    .string()
    .regex(/^bun-(?:darwin-aarch64|linux-x64-baseline|linux-aarch64|windows-x64-baseline)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["bun", "bun.exe"]),
});

const grokArtifactSchema = z.object({
  asset: z
    .string()
    .regex(/^grok-\d+\.\d+\.\d+-(?:linux-x86_64|linux-aarch64|macos-aarch64|windows-x86_64(?:\.exe)?)$/u),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["grok", "grok.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});

/**
 * Google ships the Antigravity ACP server as one zip per target with two programs in it: the
 * server, and the harness it finds beside itself. Both are hashed, because either one runs.
 */
const antigravityArtifactSchema = z.object({
  asset: z
    .string()
    .regex(/^agy-acp-server-\d+\.\d+\.\d+-(?:darwin-arm64|linux-x86_64|linux-arm64|windows-x86_64)\.zip$/u),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["agy_acp_server.par", "agy_acp_server.exe"]),
  executableSha256: sha256Schema,
  harness: z.enum(["localharness_external", "localharness_external.exe"]),
  harnessSha256: sha256Schema,
  platformDirectory: z.enum(["macos", "linux", "windows"]),
});

const agentRuntimeLockSchema = z.object({
  schemaVersion: z.literal(1),
  codex: z.object({
    repository: z.literal("https://github.com/openai/codex"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    tag: z.string().regex(/^rust-v\d+\.\d+\.\d+$/u),
    license: z.literal("Apache-2.0"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": codexArtifactSchema,
      "linux-x64": codexArtifactSchema,
      "linux-arm64": codexArtifactSchema,
      "win32-x64": codexArtifactSchema,
    }),
  }),
  claude: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    sdkVersion: z.string().regex(/^\d+\.\d+\.\d+$/u),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("Anthropic Legal Agreements"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": claudeArtifactSchema,
      "linux-x64": claudeArtifactSchema,
      "linux-arm64": claudeArtifactSchema,
      "win32-x64": claudeArtifactSchema,
    }),
  }),
  /**
   * OpenCode publishes one npm platform package per target, and the CLI reports the npm version
   * verbatim. There is no `sdkVersion` split like `claude`, so one `version` field is the whole
   * truth: the tarball name, the `package.json` inside it, and what `opencode --version` prints.
   */
  opencode: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    /** Canonical name. `github.com/sst/opencode` now redirects here, and the license fetch must not
     *  have to follow a redirect. */
    repository: z.literal("https://github.com/anomalyco/opencode"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("MIT"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": opencodeArtifactSchema,
      "linux-x64": opencodeArtifactSchema,
      "linux-arm64": opencodeArtifactSchema,
      "win32-x64": opencodeArtifactSchema,
    }),
  }),
  /**
   * The JavaScript runtime OpenBot downloads for the MCP servers, not for a provider CLI.
   *
   * `tag` is the source tag the licence is read from; `version` is what `bun --version` prints and
   * what the npm packages carry. Bun states both as the same number, and the schema keeps them
   * separate anyway, because a lock that cannot say they disagree cannot notice when they do.
   */
  bun: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    repository: z.literal("https://github.com/oven-sh/bun"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    tag: z.string().regex(/^bun-v\d+\.\d+\.\d+$/u),
    license: z.literal("MIT"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": bunArtifactSchema,
      "linux-x64": bunArtifactSchema,
      "linux-arm64": bunArtifactSchema,
      "win32-x64": bunArtifactSchema,
    }),
  }),
  grok: z.object({
    repository: z.literal("https://github.com/xai-org/grok-build"),
    distribution: z.literal("https://x.ai/cli"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    sourceCommit: z.string().regex(/^[0-9a-f]{40}$/u, "Must use a complete Git commit."),
    license: z.literal("Apache-2.0"),
    licenseSha256: sha256Schema,
    noticesSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": grokArtifactSchema,
      "linux-x64": grokArtifactSchema,
      "linux-arm64": grokArtifactSchema,
      "win32-x64": grokArtifactSchema,
    }),
  }),
  /**
   * The server that signs in with a Google AI Pro or Ultra plan. It is proprietary, so OpenBot
   * downloads it on the user's computer and does not ship it in a release. The archive has no licence
   * file: the terms are at `licenseUrl`.
   */
  antigravity: z.object({
    registry: z.literal(
      "https://raw.githubusercontent.com/agentclientprotocol/registry/main/antigravity-acp/agent.json",
    ),
    distribution: z.literal("https://dl.google.com/agy-extensions/releases"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("Proprietary"),
    licenseUrl: z.literal("https://antigravity.google/terms"),
    artifacts: z.object({
      "darwin-arm64": antigravityArtifactSchema,
      "linux-x64": antigravityArtifactSchema,
      "linux-arm64": antigravityArtifactSchema,
      "win32-x64": antigravityArtifactSchema,
    }),
  }),
});

export type AgentRuntimeLock = z.infer<typeof agentRuntimeLockSchema>;

export async function loadAgentRuntimeLock(sourceRoot = process.cwd()): Promise<AgentRuntimeLock> {
  const path = resolve(sourceRoot, "native-runtime.lock.json");
  return parseAgentRuntimeLock(JSON.parse(await readFile(path, "utf8")));
}

export function parseAgentRuntimeLock(value: unknown): AgentRuntimeLock {
  return agentRuntimeLockSchema.parse(value);
}
