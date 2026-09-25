import { isAgentTemplateId } from "@openbot/contracts/agent-template-links";
import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { createServerFn } from "@tanstack/solid-start";

/**
 * Reads one template for its public page. The read runs on the Worker, because the page needs D1;
 * the import is inside the handler so the browser bundle never holds `cloudflare:workers`.
 * An unknown or malformed id is null, which the route turns into a real not-found response.
 */
export const readAgentTemplate = createServerFn({ method: "GET" })
  .validator((id: unknown) => (typeof id === "string" ? id : ""))
  .handler(async ({ data }): Promise<AgentTemplateDetail | null> => {
    if (!isAgentTemplateId(data)) return null;
    const { requestAgentTemplates } = await import("../server/request-auth");
    try {
      return await requestAgentTemplates().get(data);
    } catch (error) {
      if (error instanceof Error && "status" in error && error.status === 404) return null;
      throw error;
    }
  });
