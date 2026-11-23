import {
  type AgentModelId,
  type AgentProviderId,
  type AppSetupState,
  isAgentModel,
  isAgentProvider,
  type SaveSetupInput,
} from "@openbot/contracts/ipc";
import { isDynamicRecord, isNumber, isString } from "@openbot/contracts/runtime-values";
import { Effect } from "effect";
import { isMissingFileError } from "../backend/file-errors";
import { type PreferenceFileFailure, readPreferenceFile, writePreferenceFile } from "./preference-file";

interface StoredSetup {
  version: 2;
  preferredProvider: AgentProviderId;
  preferredModel?: AgentModelId;
  completedAt: string;
}

const EMPTY_SETUP: AppSetupState = { completed: false, preferredProvider: null, preferredModel: null };

export function readSetupState(path: string): Effect.Effect<AppSetupState, PreferenceFileFailure> {
  return readPreferenceFile(path, (parsed): AppSetupState => {
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
      preferredModel: isAgentModel(parsed.preferredModel) ? parsed.preferredModel : null,
    };
  }).pipe(
    Effect.catch((failure) => {
      const error = failure.cause;
      if (isMissingFileError(error) || error instanceof SyntaxError) return Effect.succeed({ ...EMPTY_SETUP });
      return Effect.fail(failure);
    }),
  );
}

export function writeSetupState(
  path: string,
  input: SaveSetupInput,
): Effect.Effect<AppSetupState, PreferenceFileFailure> {
  return Effect.gen(function* () {
    const stored: StoredSetup = {
      version: 2,
      preferredProvider: input.preferredProvider,
      ...(input.preferredModel === null ? {} : { preferredModel: input.preferredModel }),
      completedAt: new Date().toISOString(),
    };
    yield* writePreferenceFile(path, stored);
    return { completed: true, ...input };
  });
}
