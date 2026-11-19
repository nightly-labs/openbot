import { isAgentModel } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { AcpModel } from "./acp-configuration";

const logger = createOpenBotLogger("provider-runtime");

/**
 * Cline's own list of the models it recommends, free and ClinePass ones included. It is public: the
 * CLI reads it without the account, and so does OpenBot.
 */
export const CLINE_RECOMMENDED_MODELS_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

/** Below the 5 s of the `model/list` that waits for it, which also waits for the CLI's own list. */
const FETCH_TIMEOUT_MS = 3_000;

const RecommendedModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

const RecommendedModels = Schema.Struct({
  free: Schema.Array(RecommendedModel),
  // Cline added it after the free tier, and an answer without it has no ClinePass models.
  clinePass: Schema.optional(Schema.Array(RecommendedModel)),
});

type RecommendedModel = typeof RecommendedModel.Type;

/** The free tier on 2026-10-19, for when Cline's list cannot be read. */
const CLINE_FREE_MODEL_FALLBACKS = [
  { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash" },
  { id: "cline-free/nemotron-3.5-super-vl", name: "Nemotron 3.5 Super VL" },
  { id: "cline-free/mimo-v2.6-flash", name: "Mimo V2.6 Flash" },
  { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
  { id: "cline-free/solar-mini4", name: "Solar Mini 4" },
];

/**
 * The ClinePass models on 2026-11-13. Without them, a saved ClinePass model would run on the session's
 * own `cline` provider, on Cline Credits, when Cline's list cannot be read.
 */
const CLINE_PASS_MODEL_FALLBACKS = [
  "cline-pass/deepseek-v4.1-flash-1017",
  "cline-pass/deepseek-v4-pro",
  "cline-pass/glm-5.3",
  "cline-pass/glm-5.3-flash",
  "cline-pass/kimi-k3.1-pro",
  "cline-pass/muse-spark-1.3-contributor",
  "cline-pass/kimi-k3",
  "cline-pass/qwen3.8-max",
  "cline-pass/minimax-m3.1-flash",
].map((id) => ({ id }));

/**
 * Reads Cline's free and ClinePass models, which `cline --acp` does not list: its ACP agent lists the
 * models of the session's provider, and only the CLI's own picker reads the other tiers from Cline.
 * The agent takes a model it did not list, so OpenBot lists them and the agent runs them. Without
 * the ClinePass models, a session signed in with `cline` stays on Cline Credits (#8587).
 *
 * Never fails. A list that cannot be read gives the last one that could, then the bundled one.
 */
export function clineFreeModels(): () => Effect.Effect<AcpModel[]> {
  let last: AcpModel[] = [
    ...CLINE_PASS_MODEL_FALLBACKS.map(clinePassModel),
    ...CLINE_FREE_MODEL_FALLBACKS.map(freeModel),
  ];
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
      const { free, clinePass = [] } = yield* Schema.decodeUnknownEffect(RecommendedModels)(body);
      // An empty tier is an answer: Cline can end it, and the picker must not keep the old one.
      last = [
        ...clinePass.filter((entry) => isAgentModel(entry.id)).map(clinePassModel),
        ...free.filter((entry) => isAgentModel(entry.id)).map(freeModel),
      ];
      return last;
    },
    Effect.catch((cause) => {
      logger.warn("Cline's free models could not be read.", { error: String(cause) });
      return Effect.succeed(last);
    }),
  );
}

// The free tier is on Cline's own billing, so the session uses the `cline` provider for it.
function freeModel(entry: RecommendedModel): AcpModel {
  return tierModel(entry, "free", "cline");
}

// A ClinePass model runs on the subscription, which is the `cline-pass` provider of the session.
function clinePassModel(entry: RecommendedModel): AcpModel {
  return tierModel(entry, "ClinePass", "cline-pass");
}

function tierModel(entry: RecommendedModel, tier: string, provider: string): AcpModel {
  // Cline names some entries by their id. The tier in the name replaces the id's tier prefix.
  const given = entry.name?.trim();
  const name = given && given !== entry.id ? given : entry.id.slice(entry.id.indexOf("/") + 1);
  return {
    id: entry.id,
    // As the Cline CLI names them, and what the picker's search for the tier finds.
    name: name.toLowerCase().endsWith(`(${tier.toLowerCase()})`) ? name : `${name} (${tier})`,
    description: entry.description?.trim() ?? "",
    defaultReasoningEffort: "medium",
    supportedReasoningEfforts: ["medium"],
    reasoningEffortConfigurable: false,
    reasoningEffortWireValues: new Map([["medium", "medium"]]),
    usesModelReasoningEffort: null,
    unlisted: { config: { provider } },
  };
}
