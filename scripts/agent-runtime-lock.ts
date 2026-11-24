import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { z } from "zod";

const sha256Schema = z.string().regex(/^[0-9a-f]{64}$/u, "Must use a complete SHA-256 value.");
const nativeProviderArtifactSchema = z.object({
  url: z.url(),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum([
    "pi",
    "pi.exe",
    "muse",
    "muse.exe",
    "devin",
    "devin.exe",
    "copilot",
    "copilot.exe",
    "vibe-acp",
    "vibe-acp.exe",
    "antigravity",
    "antigravity.exe",
  ]),
  files: z.record(z.string().min(1), sha256Schema),
});
const nativeProviderLockSchema = z.object({
  version: z.string().min(1),
  license: z.string().min(1),
  licenseUrl: z.url(),
  artifacts: z.object({
    "darwin-arm64": nativeProviderArtifactSchema,
    "darwin-x64": nativeProviderArtifactSchema,
    "linux-x64": nativeProviderArtifactSchema,
    "linux-arm64": nativeProviderArtifactSchema,
    "win32-x64": nativeProviderArtifactSchema,
  }),
});
const codexArtifactSchema = z.object({
  asset: z.string().min(1),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.string().regex(/^bin\/codex(?:\.exe)?$/u),
});
const claudeArtifactSchema = z.object({
  package: z
    .string()
    .regex(/^@anthropic-ai\/claude-agent-sdk-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64)$/u),
  asset: z
    .string()
    .regex(/^claude-agent-sdk-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|win32-x64)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["claude", "claude.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});
const opencodeArtifactSchema = z.object({
  package: z.string().regex(/^@opencode\/cli-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)$/u),
  asset: z.string().regex(/^cli-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["opencode", "opencode.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});
const bunArtifactSchema = z.object({
  package: z
    .string()
    .regex(
      /^@oven\/bun-(?:darwin-aarch64|darwin-x64-baseline|linux-x64-baseline|linux-aarch64|windows-x64-baseline)$/u,
    ),
  asset: z
    .string()
    .regex(
      /^bun-(?:darwin-aarch64|darwin-x64-baseline|linux-x64-baseline|linux-aarch64|windows-x64-baseline)-\d+\.\d+\.\d+\.tgz$/u,
    ),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["bun", "bun.exe"]),
});

const grokArtifactSchema = z.object({
  asset: z
    .string()
    .regex(/^grok-\d+\.\d+\.\d+-(?:linux-x86_64|linux-aarch64|macos-aarch64|macos-x86_64|windows-x86_64(?:\.exe)?)$/u),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["grok", "grok.exe"]),
  platformDirectory: z.enum(["linux", "mac", "win"]),
});

const cursorArtifactSchema = z.object({
  platformDirectory: z.enum(["darwin", "linux", "windows"]),
  architecture: z.enum(["arm64", "x64"]),
  asset: z.enum(["agent-cli-package.tar.gz", "agent-cli-package.zip"]),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["cursor-agent", "cursor-agent.cmd"]),
  files: z.record(z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/u), sha256Schema),
});

const clineArtifactSchema = z.object({
  package: z.string().regex(/^@cline\/cli-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)$/u),
  asset: z.string().regex(/^cli-(?:darwin-arm64|darwin-x64|linux-x64|linux-arm64|windows-x64)-\d+\.\d+\.\d+\.tgz$/u),
  assetSha256: sha256Schema,
  binarySha256: sha256Schema,
  bootstrapSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["cline", "cline.exe"]),
});

const kimiArtifactSchema = z.object({
  asset: z
    .string()
    .regex(
      /^kimi-\d+\.\d+\.\d+-(?:aarch64-apple-darwin|x86_64-apple-darwin|x86_64-unknown-linux-gnu|aarch64-unknown-linux-gnu|x86_64-pc-windows-msvc)-onedir\.(?:tar\.gz|zip)$/u,
    ),
  assetSha256: sha256Schema,
  downloadBytes: z.number().int().positive(),
  installedBytes: z.number().int().positive(),
  executable: z.enum(["kimi", "kimi.exe"]),
  files: z.record(z.string().regex(/^(?:[A-Za-z0-9_][A-Za-z0-9._-]*\/)*[A-Za-z0-9_][A-Za-z0-9._-]*$/u), sha256Schema),
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
      "darwin-x64": codexArtifactSchema,
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
      "darwin-x64": claudeArtifactSchema,
      "linux-x64": claudeArtifactSchema,
      "linux-arm64": claudeArtifactSchema,
      "win32-x64": claudeArtifactSchema,
    }),
  }),
  opencode: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    repository: z.literal("https://github.com/anomalyco/opencode"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("MIT"),
    licensePackage: z.object({ name: z.literal("opencode-ai"), version: z.string().regex(/^\d+\.\d+\.\d+$/u) }),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": opencodeArtifactSchema,
      "darwin-x64": opencodeArtifactSchema,
      "linux-x64": opencodeArtifactSchema,
      "linux-arm64": opencodeArtifactSchema,
      "win32-x64": opencodeArtifactSchema,
    }),
  }),
  bun: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    repository: z.literal("https://github.com/oven-sh/bun"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    tag: z.string().regex(/^bun-v\d+\.\d+\.\d+$/u),
    license: z.literal("MIT"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": bunArtifactSchema,
      "darwin-x64": bunArtifactSchema,
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
      "darwin-x64": grokArtifactSchema,
      "linux-x64": grokArtifactSchema,
      "linux-arm64": grokArtifactSchema,
      "win32-x64": grokArtifactSchema,
    }),
  }),
  antigravity: nativeProviderLockSchema,
  cursor: z.object({
    registry: z.literal("https://raw.githubusercontent.com/agentclientprotocol/registry/main/cursor/agent.json"),
    distribution: z.literal("https://downloads.cursor.com/lab"),
    version: z.string().regex(/^\d{4}\.\d{2}\.\d{2}-[0-9a-f]{7,40}$/u),
    license: z.literal("Proprietary"),
    licenseUrl: z.literal("https://cursor.com/terms-of-service"),
    artifacts: z.object({
      "darwin-arm64": cursorArtifactSchema,
      "darwin-x64": cursorArtifactSchema,
      "linux-x64": cursorArtifactSchema,
      "linux-arm64": cursorArtifactSchema,
      "win32-x64": cursorArtifactSchema,
    }),
  }),
  pi: nativeProviderLockSchema,
  muse: nativeProviderLockSchema,
  devin: nativeProviderLockSchema,
  copilot: nativeProviderLockSchema,
  mistral: nativeProviderLockSchema,
  cline: z.object({
    registry: z.literal("https://registry.npmjs.org"),
    repository: z.literal("https://github.com/cline/cline"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("Apache-2.0"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": clineArtifactSchema,
      "darwin-x64": clineArtifactSchema,
      "linux-x64": clineArtifactSchema,
      "linux-arm64": clineArtifactSchema,
      "win32-x64": clineArtifactSchema,
    }),
  }),
  kimi: z.object({
    repository: z.literal("https://github.com/MoonshotAI/kimi-cli"),
    version: z.string().regex(/^\d+\.\d+\.\d+$/u),
    tag: z.string().regex(/^\d+\.\d+\.\d+$/u),
    license: z.literal("Apache-2.0"),
    licenseSha256: sha256Schema,
    artifacts: z.object({
      "darwin-arm64": kimiArtifactSchema,
      "darwin-x64": kimiArtifactSchema,
      "linux-x64": kimiArtifactSchema,
      "linux-arm64": kimiArtifactSchema,
      "win32-x64": kimiArtifactSchema,
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
