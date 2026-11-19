import type { AgentTemplatePreview, AgentTemplatePublication } from "@openbot/contracts/ipc";
import type { DynamicRecord } from "@openbot/contracts/runtime-values";
import { isString } from "@openbot/contracts/runtime-values";
import { AGENT_PUBLISH_CAPABILITY, AGENT_PUBLISH_ROUTES } from "@openbot/contracts/team-protocol/agent-publish-v1";
import { sourceText } from "@openbot/i18n/source";
import { redactText } from "@openbot/logging";
import { runCauseEffect } from "../../backend/effect-boundary";
import { parsePublishAgentTemplate } from "../ipc/agent-template-handlers";
import { requireString } from "../ipc/validation";
import type { TeamApiAdmin } from "./dependencies";
import { HttpError } from "./http-error";
import type { RouteOutcome, TeamApiRequestContext } from "./request-context";
import { readJson, requireAdmin, requireVisibleBodyAgent } from "./request-helpers";

export async function routeAgentPublish(
  context: TeamApiRequestContext,
  admin: TeamApiAdmin | undefined,
  hiddenAgentIds: ReadonlySet<string>,
): Promise<RouteOutcome> {
  const { method, url, capabilities, member, request, json } = context;
  const route = method === "POST" ? routeName(url.pathname) : null;
  if (!route) return "unmatched";
  const agentTemplates = admin?.agentTemplates;
  if (!agentTemplates || !capabilities.has(AGENT_PUBLISH_CAPABILITY))
    throw new HttpError(400, sourceText("error.team.agentPublishUnsupported"));
  requireAdmin(member);
  const body = await readJson(request);
  requireVisibleBodyAgent(body, hiddenAgentIds);
  try {
    if (route === "preview") return json(200, previewBody(await runCauseEffect(agentTemplates.preview(agentId(body)))));
    if (route === "publish")
      return json(200, publicationBody(await runCauseEffect(agentTemplates.publish(publishInput(body)))));
    await runCauseEffect(agentTemplates.unpublish(agentId(body)));
    return json(200, {});
  } catch (error) {
    if (error instanceof Error && !(error instanceof HttpError)) throw new HttpError(409, redactText(error.message));
    throw error;
  }
}

function routeName(pathname: string): keyof typeof AGENT_PUBLISH_ROUTES | null {
  if (pathname === AGENT_PUBLISH_ROUTES.preview) return "preview";
  if (pathname === AGENT_PUBLISH_ROUTES.publish) return "publish";
  if (pathname === AGENT_PUBLISH_ROUTES.unpublish) return "unpublish";
  return null;
}

function agentId(body: DynamicRecord): string {
  try {
    return requireString(body.agentId, "agentId");
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent publication.");
  }
}

function publishInput(body: DynamicRecord) {
  try {
    const card = body.card;
    return parsePublishAgentTemplate({
      agentId: body.agentId,
      card: isString(card) ? new Uint8Array(Buffer.from(card, "base64")) : card,
    });
  } catch (error) {
    throw new HttpError(400, error instanceof Error ? error.message : "Invalid agent publication.");
  }
}

function previewBody({ avatarUrl: _avatarUrl, avatarImage, publication, ...preview }: AgentTemplatePreview) {
  return {
    ...preview,
    name: redactText(preview.name),
    title: redactText(preview.title),
    description: redactText(preview.description),
    skills: preview.skills.map((skill) =>
      skill.kind === "embedded"
        ? { ...skill, name: redactText(skill.name), markdown: redactText(skill.markdown) }
        : { ...skill, name: redactText(skill.name) },
    ),
    routines: preview.routines.map((routine) => ({
      ...routine,
      name: redactText(routine.name),
      instruction: redactText(routine.instruction),
    })),
    skillsError: preview.skillsError === null ? null : redactText(preview.skillsError),
    avatarImage: avatarImage
      ? { mimeType: avatarImage.mimeType, data: Buffer.from(avatarImage.bytes).toString("base64") }
      : null,
    publication: publication ? publicationBody(publication) : null,
  };
}

function publicationBody({ templateId, shareUrl, publishedAt }: AgentTemplatePublication) {
  return { templateId, shareUrl, publishedAt };
}
