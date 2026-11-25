import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { createServerFn } from "@tanstack/solid-start";
import { runApiEffect } from "../server/effect-runtime";

export const readAgentTemplate = createServerFn({ method: "GET" })
  .validator((id: unknown) => (typeof id === "string" ? id : ""))
  .handler(async ({ data }): Promise<AgentTemplateDetail | null> => {
    if (!isAgentTemplateId(data)) return null;
    const { requestAgentTemplates } = await import("../server/request-auth");
    try {
      return await runApiEffect(requestAgentTemplates().get(data));
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) return null;
      throw error;
    }
  });
