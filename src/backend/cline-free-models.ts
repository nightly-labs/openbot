import { isAgentModel } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { AcpModel } from "./acp-configuration";

const logger = createOpenBotLogger("provider-runtime");

/**
 * Cline's own list of the models it recommends, free ones included. It is public: the CLI reads it
 * without the account, and so does OpenBot.
 */
export const CLINE_RECOMMENDED_MODELS_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

/** Below the 5 s of the `model/list` that waits for it, which also waits for the CLI's own list. */
const FETCH_TIMEOUT_MS = 3_000;

const RecommendedModels = Schema.Struct({
  free: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      name: Schema.optional(Schema.String),
      description: Schema.optional(Schema.String),
    }),
  ),
});

/** The free tier on 2026-10-19, for when Cline's list cannot be read. */
const CLINE_FREE_MODEL_FALLBACKS = [
  { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash" },
  { id: "cline-free/nemotron-3.5-super-vl", name: "Nemotron 3.5 Super VL" },
  { id: "cline-free/mimo-v2.6-flash", name: "Mimo V2.6 Flash" },
  { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
  { id: "cline-free/solar-mini4", name: "Solar Mini 4" },
];

/**
 * Reads Cline's free models, which `cline --acp` does not list: its ACP agent lists the OpenRouter
 * catalog bundled into the CLI, and only the CLI's own picker reads the free tier from Cline. The
 * agent takes a model it did not list, so OpenBot lists them and the agent runs them.
 *
 * Never fails. A list that cannot be read gives the last one that could, then the bundled one.
 */
export function clineFreeModels(): () => Effect.Effect<AcpModel[]> {
  let last: AcpModel[] = CLINE_FREE_MODEL_FALLBACKS.map(freeModel);
  return Effect.fn("ClineFreeModels.read")(
    function* () {
      // One deadline for the headers and the body: a body that stalls must not hold the model list.
      const body = yield* Effect.tryPromise({
        try: async (signal) => {
          const response = await fetch(CLINE_RECOMMENDED_MODELS_URL, {
            signal,
            headers: { accept: "application/json" },
          });
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return await response.json();
        },
        catch: (cause) => cause,
      }).pipe(Effect.timeout(FETCH_TIMEOUT_MS));
      const { free } = yield* Schema.decodeUnknownEffect(RecommendedModels)(body);
      // An empty free tier is an answer: Cline can end it, and the picker must not keep the old one.
      last = free.filter((entry) => isAgentModel(entry.id)).map(freeModel);
      return last;
    },
    Effect.catch((cause) => {
      logger.warn("Cline's free models could not be read.", { error: String(cause) });
      return Effect.succeed(last);
    }),
  );
}

function freeModel(entry: { id: string; name?: string | undefined; description?: string | undefined }): AcpModel {
  const name = entry.name?.trim() || entry.id;
  return {
    id: entry.id,
    // As the Cline CLI names them, and what the picker's search for "free" finds.
    name: /\(free\)$/i.test(name) ? name : `${name} (free)`,
    description: entry.description?.trim() ?? "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
    reasoningEffortWireValues: new Map([["medium", "medium"]]),
    usesModelReasoningEffort: null,
    // The free tier is on Cline's own billing, so the session uses the `cline` provider for it.
    unlisted: { config: { provider: "cline" } },
  };
}
