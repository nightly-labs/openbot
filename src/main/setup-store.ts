import { readFile, writeFile } from "node:fs/promises";
import {
  type AgentModelId,
  type AgentProviderId,
  type AppSetupState,
  isAgentModel,
  isAgentProvider,
  type SaveSetupInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";

interface StoredSetup {
  version: 2;
  preferredProvider: AgentProviderId;
  /**
   * Added after version 2 shipped, and the version stays at 2 on purpose: a bump would make every
   * completed setup unreadable and send those users through onboarding again. A file without the
   * field means the provider's own default model, which is what those users already have.
   */
  preferredModel?: AgentModelId;
  completedAt: string;
}

const EMPTY_SETUP: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

export async function readSetupState(path: string): Promise<AppSetupState> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    if (
      !isDynamicRecord(parsed) ||
      !isNumber(parsed.version) ||
      parsed.version !== 2 ||
      !isAgentProvider(parsed.preferredProvider) ||
      !isString(parsed.completedAt)
    ) {
      return { ...EMPTY_SETUP };
    }
    return {
      completed: true,
      preferredProvider: parsed.preferredProvider,
      // A malformed model is dropped rather than failing the whole read: the provider is still a
      // usable answer, and the model falls back to that provider's default.
      preferredModel: isAgentModel(parsed.preferredModel) ? parsed.preferredModel : null,
    };
  } catch (error) {
    if (isMissing(error) || error instanceof SyntaxError) return { ...EMPTY_SETUP };
    throw error;
  }
}

export async function writeSetupState(path: string, input: SaveSetupInput): Promise<AppSetupState> {
  const stored: StoredSetup = {
    version: 2,
    preferredProvider: input.preferredProvider,
    ...(input.preferredModel === null ? {} : { preferredModel: input.preferredModel }),
    completedAt: new Date().toISOString(),
  };
  await writeFile(path, `${JSON.stringify(stored)}\n`, { encoding: "utf8", mode: 0o600 });
  return { completed: true, ...input };
}

function isMissing(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === "ENOENT";
}
