import { Effect } from "effect";
// The agent marketplace: browsing, submitting and installing a published agent.

import type { AgentMarketplaceService } from "../agent-marketplace-service";
import { parseInstallMarketplaceAgent, parseMarketplaceAgentQuery, parseSubmitMarketplaceAgent } from "./app-inputs";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { nullishPayload, stringPayload } from "./validation";

export interface MarketplaceAgentIpcDependencies {
  marketplaceAgents: AgentMarketplaceService;
}

export function marketplaceAgentIpcHandlers({
  marketplaceAgents,
}: MarketplaceAgentIpcDependencies): Pick<IpcGroupHandlers, "marketplaceAgents"> {
  return {
    marketplaceAgents: {
      list: payloadHandler(nullishPayload(parseMarketplaceAgentQuery), (query) =>
        Effect.runPromise(marketplaceAgents.list(query).pipe(Effect.mapError((error) => error.cause))),
      ),
      get: payloadHandler(stringPayload("agentId"), (agentId) =>
        Effect.runPromise(marketplaceAgents.get(agentId).pipe(Effect.mapError((error) => error.cause))),
      ),
      listMine: handler(() =>
        Effect.runPromise(marketplaceAgents.listMine().pipe(Effect.mapError((error) => error.cause))),
      ),
      preview: payloadHandler(stringPayload("agentId"), (agentId) =>
        Effect.runPromise(marketplaceAgents.preview(agentId).pipe(Effect.mapError((error) => error.cause))),
      ),
      submit: payloadHandler(parseSubmitMarketplaceAgent, (submission) =>
        Effect.runPromise(marketplaceAgents.submit(submission).pipe(Effect.mapError((error) => error.cause))),
      ),
      install: payloadHandler(parseInstallMarketplaceAgent, (installation) =>
        Effect.runPromise(marketplaceAgents.install(installation).pipe(Effect.mapError((error) => error.cause))),
      ),
    },
  };
}
