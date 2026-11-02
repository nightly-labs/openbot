import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import { createFileRoute, notFound } from "@tanstack/solid-router";
import { AgentTemplateNotSharedPage } from "../../components/agents/AgentTemplateNotSharedPage";
import { AgentTemplatePage } from "../../components/agents/AgentTemplatePage";
import { agentTemplatePath } from "../../lib/agent-template-path";
import { readAgentTemplate } from "../../lib/agent-templates";
import { OPENBOT_SOCIAL_IMAGE_ALT, OPENBOT_SOCIAL_IMAGE_URL } from "../../lib/site-metadata";

async function loadAgentTemplate(templateId: string): Promise<AgentTemplateDetail> {
  const template = await readAgentTemplate({ data: templateId });
  if (!template) throw notFound();
  return template;
}

/**
 * A shared agent is public to anyone with the link, but it is not a listing: the page asks search
 * engines to stay out and sits in no sitemap. The IPC contracts and the Markdown parser load when the
 * head runs, because `head` stays in the bundle of every page (see routes/compare/$slug.tsx).
 */
async function agentTemplateHead(template: AgentTemplateDetail, siteUrl: string) {
  const { AGENT_TEMPLATE_CARD } = await import("@openbot/contracts/ipc");
  const { markdownPreviewText } = await import("@openbot/contracts/markdown-preview-text");
  const url = new URL(agentTemplatePath(template.id), siteUrl).toString();
  const title = `${template.name} — OpenBot agent`;
  const description = template.title || markdownPreviewText(template.description).slice(0, 200);
  // The agent's own share card when the publish sent one, so a post on X shows this agent.
  const card = template.cardUrl
    ? {
        url: new URL(template.cardUrl, siteUrl).toString(),
        alt: `${template.name}, an OpenBot agent by ${template.creatorName}`,
      }
    : { url: OPENBOT_SOCIAL_IMAGE_URL, alt: OPENBOT_SOCIAL_IMAGE_ALT };
  return {
    meta: [
      { title },
      { name: "description", content: description },
      { name: "robots", content: "noindex, nofollow" },
      { property: "og:type", content: "website" },
      { property: "og:site_name", content: "OpenBot" },
      { property: "og:url", content: url },
      { property: "og:title", content: title },
      { property: "og:description", content: description },
      { property: "og:image", content: card.url },
      { property: "og:image:alt", content: card.alt },
      ...(template.cardUrl
        ? [
            { property: "og:image:type", content: "image/png" },
            { property: "og:image:width", content: String(AGENT_TEMPLATE_CARD.width) },
            { property: "og:image:height", content: String(AGENT_TEMPLATE_CARD.height) },
          ]
        : []),
      { name: "twitter:card", content: "summary_large_image" },
      { name: "twitter:title", content: title },
      { name: "twitter:description", content: description },
      { name: "twitter:image", content: card.url },
      { name: "twitter:image:alt", content: card.alt },
    ],
    links: [{ rel: "canonical", href: url }],
  };
}

const NOT_SHARED_HEAD = {
  meta: [{ title: "Agent no longer shared — OpenBot" }, { name: "robots", content: "noindex, nofollow" }],
};

export const Route = createFileRoute("/agents/$templateId")({
  loader: ({ params }) => loadAgentTemplate(params.templateId),
  head: ({ loaderData, match }) => {
    if (loaderData) return agentTemplateHead(loaderData, match.context.siteUrl);
    // The not-found page below shows in place of the agent. A failed load keeps the site title.
    return match.status === "notFound" ? NOT_SHARED_HEAD : {};
  },
  // Not cached: the page shows the instructions, which an unpublish must take back at once.
  headers: () => ({ "X-Robots-Tag": "noindex, nofollow", "Cache-Control": "private, no-store" }),
  component: AgentTemplateRoute,
  // An unpublished agent and an unknown id are both a 404 from the loader.
  notFoundComponent: AgentTemplateNotSharedPage,
});

function AgentTemplateRoute() {
  const template = Route.useLoaderData();
  return <AgentTemplatePage template={template()} />;
}
