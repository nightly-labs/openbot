import { type AgentTemplateDetail, decodeAgentTemplateDetail } from "@openbot/contracts/ipc";
import { fetch } from "expo/fetch";
import { currentText } from "@/shared/lib/text";

const AGENT_TEMPLATE_REQUEST_TIMEOUT_MS = 10_000;

/** The account service has no template with this id: it was never published, or it was unpublished. */
export class AgentTemplateNotFoundError extends Error {
  constructor() {
    super(currentText().t("mobile.link.template.notFound.description"));
  }
}

/** A public read: the template page shows the same data without sign-in, so no credential is sent. */
export async function loadAgentTemplate(
  apiUrl: string,
  templateId: string,
  signal?: AbortSignal,
): Promise<AgentTemplateDetail> {
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener("abort", abort, { once: true });
  if (signal?.aborted) controller.abort();
  const timeout = setTimeout(abort, AGENT_TEMPLATE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(new URL(`/v1/agent-templates/${encodeURIComponent(templateId)}`, apiUrl).toString(), {
      signal: controller.signal,
    });
    if (response.status === 404) throw new AgentTemplateNotFoundError();
    if (!response.ok) throw new Error(currentText().t("mobile.link.template.error.loadFailed"));
    const detail = decodeAgentTemplateDetail(await response.json());
    if (detail.id !== templateId) throw new Error(currentText().t("mobile.link.template.error.loadFailed"));
    return detail;
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener("abort", abort);
  }
}
