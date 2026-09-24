import { Link } from "@tanstack/solid-router";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";

export function OpenBotVsGrokBot() {
  return (
    <>
      <p>
        At first glance, OpenBot and Grok Bot look similar: both let you give ongoing agents tasks and return to the
        same work later. The main difference is where the work runs and how much of the setup you control.
      </p>

      <h2>The Same Starting Point</h2>
      <p>
        Both products are built around agents that can keep working beyond a one-off chat. You can give an agent a role,
        add context, and return to its conversation as the task develops. You can also work with more than one agent on
        a project instead of keeping every part of the work in a separate chat.
      </p>
      <p>
        That shared starting point can make the apps feel familiar. The differences become clearer when you look at the
        computers, providers, and tools behind the agents.
      </p>

      <h2>Where the Work Happens</h2>
      <p>
        OpenBot runs on the computer that hosts it. Agent workspaces, conversations, and app data stay on that machine.
        The host needs to be available while its agents are working. If an agent uses a hosted provider, that provider
        still handles the model requests; local-first does not mean fully offline.
      </p>
      <p>
        Grok Bot runs its work in the cloud, so a task can continue when your laptop is closed. Its current
        documentation describes one persistent cloud computer for each user, shared by that user's Bots—including their
        files, browser sessions, and app logins.{" "}
        <a href={OPENBOT_LINKS.grokBotOverview} target="_blank" rel={EXTERNAL_LINK_REL}>
          Grok Bot's overview
        </a>{" "}
        explains how that computer is used.
      </p>

      <h2>Providers and Control</h2>
      <p>
        OpenBot can run provider tools such as Codex, Claude Code, Grok CLI, and OpenCode. You can move an agent between
        supported providers while keeping its role, workspace, and conversation. That gives you a choice of provider
        tools while keeping the project files and history with the agent.
      </p>
      <p>
        Grok Bot provides a managed cloud environment, with its model and computer setup handled inside the service.
        That means less of the environment is yours to configure, while the Bots can use the browser, filesystem, and
        terminal provided there. The right fit depends on whether you want to manage a local setup or use a hosted one.
      </p>

      <h2>How Their Teams Work</h2>
      <p>
        Both apps let agents coordinate instead of making you pass every message between them. In OpenBot, a lead agent
        can assign parts of a task to other agents through a shared channel. You can follow their work and step in when
        a decision or approval is needed, without directing every handoff yourself.
      </p>
      <p>
        Grok Bot also lets Bots message one another, work in parallel, and hand tasks across the team. Its Bots share
        the same cloud computer for that account, which gives them access to the same files and browser sessions. The
        difference is not that one product has teamwork and the other does not; it is the environment and control around
        that teamwork.
      </p>

      <h2>What the Difference Means in Practice</h2>
      <p>
        If you want agent work close to local files, a choice of provider tools, and control over the host computer,
        OpenBot gives you that setup. If you want tasks to keep running on a managed cloud computer after you leave your
        own device, Grok Bot provides that environment.
      </p>
      <p>
        The useful question is where you want the work to live and how much of the environment you want to manage. For a
        closer look at OpenBot's agents, workspaces, and provider setup, see{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          OpenBot 101
        </Link>
        .
      </p>
    </>
  );
}
