import { isAgentModel } from "@openbot/contracts/ipc";
import { createOpenBotLogger } from "@openbot/logging";
import { Effect, Schema } from "effect";
import type { AcpModel } from "./acp-configuration";

const logger = createOpenBotLogger("provider-runtime");

export const CLINE_RECOMMENDED_MODELS_URL = "https://api.cline.bot/api/v1/ai/cline/recommended-models";

const FETCH_TIMEOUT_MS = 3_000;

const RecommendedModel = Schema.Struct({
  id: Schema.String,
  name: Schema.optional(Schema.String),
  description: Schema.optional(Schema.String),
});

const RecommendedModels = Schema.Struct({
  free: Schema.Array(RecommendedModel),
  clinePass: Schema.optional(Schema.Array(RecommendedModel)),
});

type RecommendedModel = typeof RecommendedModel.Type;

const CLINE_FREE_MODEL_FALLBACKS = [
  { id: "cline-free/minimax-m3.1-flash", name: "Minimax M3.1 Flash" },
  { id: "cline-free/nemotron-3.5-super-vl", name: "Nemotron 3.5 Super VL" },
  { id: "cline-free/mimo-v2.6-flash", name: "Mimo V2.6 Flash" },
  { id: "cline-free/muse-spark-1.3-contributor", name: "Muse Spark 1.3 Contributor" },
  { id: "cline-free/solar-mini4", name: "Solar Mini 4" },
];

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

export function clineFreeModels(): () => Effect.Effect<AcpModel[]> {
  let last: AcpModel[] = [
    ...CLINE_PASS_MODEL_FALLBACKS.map(clinePassModel),
    ...CLINE_FREE_MODEL_FALLBACKS.map(freeModel),
  ];
  return Effect.fn("ClineFreeModels.read")(
    function* () {
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

function freeModel(entry: RecommendedModel): AcpModel {
  return tierModel(entry, "free", "cline");
}

function clinePassModel(entry: RecommendedModel): AcpModel {
  return tierModel(entry, "ClinePass", "cline-pass");
}

function tierModel(entry: RecommendedModel, tier: string, provider: string): AcpModel {
  const given = entry.name?.trim();
  const name = given && given !== entry.id ? given : entry.id.slice(entry.id.indexOf("/") + 1);
  return {
    id: entry.id,
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
