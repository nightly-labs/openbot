import { Effect } from "effect";
// Link-only agent templates: publishing a local agent, and previewing and installing a shared one.

import {
  type InstallAgentTemplateInput,
  isAgentTemplateCardPng,
  type PublishAgentTemplateInput,
} from "@openbot/contracts/ipc";
import { sourceText } from "@openbot/i18n/source";
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
      preview: payloadHandler(stringPayload("agentId"), (agentId) =>
        Effect.runPromise(agentTemplates.preview(agentId).pipe(Effect.mapError((error) => error.cause))),
      ),
      publish: payloadHandler(parsePublishAgentTemplate, (input) =>
        Effect.runPromise(agentTemplates.publish(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      unpublish: payloadHandler(stringPayload("agentId"), (agentId) =>
        Effect.runPromise(agentTemplates.unpublish(agentId).pipe(Effect.mapError((error) => error.cause))),
      ),
      get: payloadHandler(stringPayload("templateId"), (templateId) =>
        Effect.runPromise(agentTemplates.get(templateId).pipe(Effect.mapError((error) => error.cause))),
      ),
      install: payloadHandler(parseInstallAgentTemplate, (input) =>
        Effect.runPromise(agentTemplates.install(input).pipe(Effect.mapError((error) => error.cause))),
      ),
      takePendingLink: handler(takePendingLink),
    },
  };
}

export function parseInstallAgentTemplate(input: unknown): InstallAgentTemplateInput {
  if (!isObject(input)) throw new Error("Invalid agent installation.");
  return {
    templateId: requireString(input.templateId, "templateId"),
    timezone: requireString(input.timezone, "timezone", 255),
    expectedUpdatedAt: requireString(input.expectedUpdatedAt, "expectedUpdatedAt", 64),
  };
}

export function parsePublishAgentTemplate(input: unknown): PublishAgentTemplateInput {
  if (!isObject(input)) throw new Error("Invalid agent publication.");
  const card = input.card;
  if (card !== null && !(card instanceof Uint8Array && isAgentTemplateCardPng(card)))
    throw new Error(sourceText("error.marketplace.shareCardInvalid"));
  return { agentId: requireString(input.agentId, "agentId"), card };
}
