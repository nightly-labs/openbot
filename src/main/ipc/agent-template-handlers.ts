// Link-only agent templates: publishing a local agent, and previewing and installing a shared one.

import type { InstallAgentTemplateInput } from "@openbot/contracts/ipc";
import type { AgentTemplateService } from "../agent-template-service";
import { handler, type IpcGroupHandlers, payloadHandler } from "./define-ipc-group";
import { isObject, requireString, stringPayload } from "./validation";

export interface AgentTemplateIpcDependencies {
  agentTemplates: AgentTemplateService;
  /** The id of an agent link that arrived before a window could be told, taken exactly once. */
  takePendingLink: () => string | null;
}

/**
 * There is no endpoint that installs from a link. A link names a template; installing it is still
 * a press of Install in the dialog that shows its content.
 */
export function agentTemplateIpcHandlers({
  agentTemplates,
  takePendingLink,
}: AgentTemplateIpcDependencies): Pick<IpcGroupHandlers, "agentTemplates"> {
  return {
    agentTemplates: {
      preview: payloadHandler(stringPayload("agentId"), (agentId) => agentTemplates.preview(agentId)),
      publish: payloadHandler(stringPayload("agentId"), (agentId) => agentTemplates.publish(agentId)),
      unpublish: payloadHandler(stringPayload("agentId"), (agentId) => agentTemplates.unpublish(agentId)),
      get: payloadHandler(stringPayload("templateId"), (templateId) => agentTemplates.get(templateId)),
      install: payloadHandler(parseInstallAgentTemplate, (input) => agentTemplates.install(input)),
      takePendingLink: handler(takePendingLink),
    },
  };
}

function parseInstallAgentTemplate(input: unknown): InstallAgentTemplateInput {
  if (!isObject(input)) throw new Error("Invalid agent installation.");
  return {
    templateId: requireString(input.templateId, "templateId"),
    timezone: requireString(input.timezone, "timezone", 255),
  };
}
