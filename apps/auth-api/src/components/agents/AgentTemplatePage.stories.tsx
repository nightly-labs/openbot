import type { AgentTemplateDetail } from "@openbot/contracts/ipc";
import type { JSX } from "@solidjs/web";
import { createRootRoute, createRoute, createRouter, RouterContextProvider } from "@tanstack/solid-router";
import type { Meta, StoryObj } from "storybook-solidjs-vite";
// The site's stylesheet, loaded only when a site story opens. See `ArticleMedia.stories.tsx`.
import "../../styles.css";
import { AgentTemplatePage } from "./AgentTemplatePage";

const TEMPLATE: AgentTemplateDetail = {
  id: "wTLRFPB3M8OPQf8gfoQ_mA",
  name: "dr eggbot",
  title: "Agent designer",
  description:
    "Designs high-quality agents. Asks a few preference questions, then creates them. Coding agents get one job, no filler, and a verified result. Other agents get the same tightness: one voice, explicit anti-jobs, and no extra tools.\n\nWrite in lowercase. Act fast when the goal is clear.",
  avatarSeed: "dr-eggbot",
  avatarHue: 0,
  avatarUrl: null,
  creatorName: "Sam Rivera",
  updatedAt: "2026-09-25T09:00:00.000Z",
  skills: [
    {
      kind: "marketplace",
      skillId: "skill-agent-review",
      versionId: "v3",
      slug: "agent-review",
      name: "Agent review",
      version: 3,
    },
    {
      kind: "embedded",
      slug: "poteto-mode",
      name: "poteto-mode",
      markdown:
        "---\nname: poteto-mode\ndescription: One job, no filler, verified.\n---\n\nKeep each agent to one job.",
    },
  ],
  routines: [
    {
      name: "transcript-healthcheck",
      instruction: "Read the last day of transcripts and report agents that drifted from their job.",
      active: true,
      schedule: { kind: "weekdays", time: "08:44" },
    },
    {
      name: "routine-healthcheck",
      instruction: "Check that every routine ran on time this week.",
      active: true,
      schedule: { kind: "weekly", weekday: 1, time: "08:49" },
    },
  ],
};

/**
 * The page needs a router for its header and footer links. The real route tree carries Worker-only
 * modules, so this is the same small stand-in tree `test/plugins-page.test.tsx` uses. It is built at
 * module level: creating a router writes reactive state, which Solid refuses inside a component.
 */
const rootRoute = createRootRoute();
rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: "/" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/news" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/guides" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/plugins" }),
  createRoute({ getParentRoute: () => rootRoute, path: "/plugins/$slug" }),
]);
const router = createRouter({ routeTree: rootRoute });

function WithRouter(props: { children: () => JSX.Element }) {
  return <RouterContextProvider router={router}>{props.children}</RouterContextProvider>;
}

const meta = {
  title: "Site/Agent template page",
  component: AgentTemplatePage,
  args: { template: TEMPLATE },
  parameters: { layout: "fullscreen", a11y: { test: "error" } },
  render: (args) => <WithRouter>{() => <AgentTemplatePage {...args} />}</WithRouter>,
} satisfies Meta<typeof AgentTemplatePage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** What `openbot.run/agents/<id>` shows. "Add to OpenBot" opens `openbot://agents/<id>`. */
export const SharedAgent: Story = {};

export const InstructionsOnly: Story = {
  args: { template: { ...TEMPLATE, title: "", skills: [], routines: [] } },
};
