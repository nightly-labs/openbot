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
      list: payloadHandler(nullishPayload(parseMarketplaceAgentQuery), (query) => marketplaceAgents.list(query)),
      get: payloadHandler(stringPayload("agentId"), (agentId) => marketplaceAgents.get(agentId)),
      listMine: handler(() => marketplaceAgents.listMine()),
      preview: payloadHandler(stringPayload("agentId"), (agentId) => marketplaceAgents.preview(agentId)),
      submit: payloadHandler(parseSubmitMarketplaceAgent, (submission) => marketplaceAgents.submit(submission)),
      install: payloadHandler(parseInstallMarketplaceAgent, (installation) => marketplaceAgents.install(installation)),
    },
  };
}
