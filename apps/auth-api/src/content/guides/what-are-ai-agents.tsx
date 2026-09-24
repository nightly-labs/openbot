import { Link } from "@tanstack/solid-router";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";

export function WhatAreAIAgents() {
  return (
    <>
      <p>
        AI agents are software systems that use an AI model to work toward a goal. Depending on how they are built, they
        can take several steps, use connected tools, and adjust what they do based on what happens. This guide explains
        how AI agents work, what they are useful for, and when a chatbot or regular automation may be enough.
      </p>

      <h2>What Is an AI Agent?</h2>
      <p>
        The term is used in different ways, but an AI agent generally uses a model to carry out a task through one or
        more steps. The model generates responses and, in some setups, helps decide what to do next. Instructions set
        the agent's role and limits, context gives it information about the task, and connected tools let it interact
        with files or apps.
      </p>
      <p>
        Not every agent has the same setup. Some follow a mostly fixed process; others decide which steps to take as
        they go. Features such as persistent memory, a dedicated workspace, or a team of agents depend on the
        product—they are not requirements for every AI agent.
      </p>

      <h2>How Do AI Agents Work?</h2>
      <p>
        Say you ask an agent to compare three project-management tools for a small team. If it has browser access, it
        could check each tool's pricing and integrations, put the details into a table, and link to the pages it used.
        If a detail is missing, it should flag it rather than fill the gap with a guess.
      </p>
      <p>
        The agent uses the results of each step to decide whether to continue, try another approach, finish, or ask you
        for help. The tools it has been given determine what it can actually see and do; an agent does not automatically
        have access to your files or apps.
      </p>

      <h2>AI Agents vs. Chatbots and Automation</h2>
      <p>
        A chatbot describes how you interact with a system: through a conversation. An agent describes what the system
        can do. A chat interface can be the way you give instructions to an agent.
      </p>
      <p>
        A traditional automation follows steps set in advance. An agent can choose or adjust its next step based on the
        task and what it finds. Many systems combine the two.
      </p>
      <p>
        The terminology varies, but{" "}
        <a href={OPENBOT_LINKS.anthropicAgents} target="_blank" rel={EXTERNAL_LINK_REL}>
          Anthropic describes agents
        </a>{" "}
        as systems that “dynamically direct their own processes and tool usage,” in contrast to workflows that follow
        predefined paths.
      </p>

      <h2>What Are AI Agents Used For?</h2>
      <p>
        With the right tools and permissions, an agent can help with work that involves several steps. For example, it
        could:
      </p>
      <ul>
        <li>compare vendor plans using their pricing pages, then list the differences with source links;</li>
        <li>read a code issue, inspect the relevant files, make a change, and report which tests it ran;</li>
        <li>gather weekly figures from connected apps and prepare an update for review.</li>
      </ul>
      <p>What an agent can do depends on its model, tools, instructions, and permissions.</p>

      <h2>When Should You Use an AI Agent?</h2>
      <p>
        An agent is useful when you know the outcome you want, but the steps may depend on what happens along the way.
        Research, code changes, and reports based on several sources can all involve decisions during the task.
      </p>
      <p>
        For a quick question, a chatbot may be enough. If the same predictable steps need to run every time, a regular
        automation may be a better fit. An agent is most useful when it can move work forward across several steps
        without needing a new instruction after each one.
      </p>

      <h2>What Are the Limitations of AI Agents?</h2>
      <p>
        An agent can misunderstand a request, use incomplete or outdated information, or make a poor choice about what
        to do next. Errors can also build up over a longer task, so check important facts, sources, and changes before
        relying on the result.{" "}
        <a href={OPENBOT_LINKS.anthropicAgents} target="_blank" rel={EXTERNAL_LINK_REL}>
          Anthropic also notes
        </a>{" "}
        that greater autonomy can bring higher costs and compounding errors in some systems.
      </p>
      <p>
        Access matters too. An agent can only work with the files, apps, and actions it has been allowed to use. For
        actions such as sending a message, changing a record, or publishing something, set clear limits and require
        approval when needed.
      </p>

      <h2>How to Get Useful Results from an AI Agent</h2>
      <p>
        Give the agent a clear outcome, the context it needs, and a way to tell when the task is done. Specify which
        tools it can use and which actions need your approval. For research tasks, ask it to link its sources and flag
        anything it could not verify.
      </p>
      <p>
        For example, instead of asking for a general comparison, ask for a table based on three official pricing pages,
        with links and missing details clearly marked. Review the result before letting the agent take any consequential
        action.
      </p>

      <h2>AI Agents in OpenBot</h2>
      <p>
        OpenBot gives each agent a role, workspace, and conversation. Agents can hand work and files to one another
        while the project stays together. OpenBot organizes the work around the connected provider; that provider still
        handles the model requests.
      </p>
      <p>
        OpenBot is local-first, but that does not necessarily mean the model runs on your computer. The workspace can be
        local while a connected provider handles the requests. For a closer look, see{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          OpenBot 101
        </Link>
        .
      </p>
    </>
  );
}
