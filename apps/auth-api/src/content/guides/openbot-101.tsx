import { Link } from "@tanstack/solid-router";
import { ArticleImage } from "../../components/content/ArticleMedia";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import aChannel from "./media/openbot-101/a-channel.webp";
import aRoutine from "./media/openbot-101/a-routine.webp";
import agentCollaboration from "./media/openbot-101/agent-collaboration.png";
import agentPermissions from "./media/openbot-101/agent-permissions.png";
import providers from "./media/openbot-101/providers.png";

export function OpenBot101() {
  return (
    <>
      <p>
        I built OpenBot because I wanted teammates that could keep their work between tasks. An agent keeps its
        workspace, saved conversations and identity after a restart, and when you change its model or provider.
      </p>
      <p>
        This is the page I would send someone who has never opened the app. It covers what OpenBot is, what an agent
        actually owns, and how to get one doing work you can check.
      </p>

      <h2>What OpenBot is</h2>
      <p>
        OpenBot is a workspace for AI agents that run on your computer or a server you connect to. You can use providers
        such as{" "}
        <a href={OPENBOT_LINKS.codex} target="_blank" rel={EXTERNAL_LINK_REL}>
          ChatGPT through Codex
        </a>
        ,{" "}
        <a href={OPENBOT_LINKS.claude} target="_blank" rel={EXTERNAL_LINK_REL}>
          Claude Code
        </a>
        , Gemini, Grok and OpenCode, or connect a supported API endpoint. OpenBot handles the provider tools behind the
        scenes. Each agent gets its own workspace, saved conversations and identity.
      </p>
      <p>
        OpenBot saves conversations and application records in a local database called <code>openbot.db</code>. The
        files your agents create live in their workspace folders. The computer or server running OpenBot holds the main
        copy of this work. If you connect the mobile app, your phone also keeps an encrypted copy of recently loaded
        chats.
      </p>
      <p>
        <strong>Local-first is not the same as offline.</strong> Codex still talks to OpenAI, Claude to Anthropic, Grok
        to xAI. To answer you, the selected provider receives your messages and the context it needs, which can include
        excerpts from earlier work. Pages in the embedded browser use the network, and plugins can send information to
        the services they connect to.
      </p>

      <h2>Anatomy of an agent</h2>
      <p>An agent has its own workspace, conversations, identity and a session with its selected provider:</p>
      <ul>
        <li>
          <strong>A workspace.</strong> A folder for its files, by default at{" "}
          <code>~/OpenBot/Agents/&lt;agent-id&gt;</code>. Agents on the same computer or server can also exchange files
          through <code>~/OpenBot/Shared</code>.
        </li>
        <li>
          <strong>Saved conversations.</strong> A main chat and any separate task threads. You can return to earlier
          messages and inspect the available activity.
        </li>
        <li>
          <strong>An identity.</strong> A name, an avatar, a short role and the instructions you wrote for it.
        </li>
        <li>
          <strong>A provider session.</strong> The session used by the selected provider. It is separate from your saved
          OpenBot conversation and can be replaced when the provider or account changes.
        </li>
      </ul>
      <p>
        Move an agent from Codex to Claude and its files, saved conversations and name stay put. OpenBot gives the new
        session relevant conversation history. The previous provider's internal state does not transfer with it, and the
        full saved history is not automatically included in every request.
      </p>

      <h2>Install it, then connect a provider</h2>
      <p>
        OpenBot runs on macOS 13 or newer on Apple silicon or Intel, Windows 10 or newer on x64, and x64 or arm64 Linux
        as an AppImage. Grab the installer from{" "}
        <a href={OPENBOT_LINKS.releases} target="_blank" rel={EXTERNAL_LINK_REL}>
          GitHub Releases
        </a>
        . The Windows installer is code-signed, but SmartScreen can still warn about a new release. Check the release
        checksum before you run it. On Ubuntu 23.10 or newer and on Debian 13, the AppImage needs an AppArmor profile
        first.{" "}
        <a href={OPENBOT_LINKS.documentation} target="_blank" rel={EXTERNAL_LINK_REL}>
          The README
        </a>{" "}
        has the two commands that install it.
      </p>
      <p>
        Then pick a provider. In onboarding, in Settings or in the model picker, select one and press{" "}
        <strong>Download</strong> if it needs a provider tool. OpenBot can download and manage that tool for you and
        checks for updates automatically. It can also use a compatible installation already on the computer running the
        agent. The provider settings show which version is running.
      </p>
      <p>
        Follow the provider's sign-in steps in OpenBot, or add an API key if that provider uses one. Some providers can
        reuse a sign-in already present on the computer running the agent. You do not need an existing terminal setup to
        use the providers that OpenBot can install for you.
      </p>
      <ArticleImage
        src={providers}
        alt="OpenBot Providers settings with ChatGPT selected as the default provider and the Connected list below."
        width={1415}
        height={1111}
        mountOn="How to Use OpenBot: Set Up Your First AI Agent"
        caption="Open Providers in Settings to see which providers are connected and choose the default for new agents."
      />

      <h2>Your first task</h2>
      <p>
        Create an agent, give it a name and choose a connected provider and model. Use its instructions to describe the
        work it should help with. Then give it a small task whose result you can check. For example, attach a document
        and ask: “Read this document, list the three decisions I need to make, and save a summary in your workspace.”
      </p>
      <p>
        Then look at the activity under the answer, not only the answer. The thread shows the files the agent opened and
        the commands it ran. That is how you tell whether it did the work or described it.
      </p>

      <h2>Choose your agent's permissions</h2>
      <p>
        Open <strong>Permissions</strong> in the agent's settings to choose <strong>Workspace only</strong>,{" "}
        <strong>Ask first</strong> or <strong>Full access</strong>. Workspace only limits file changes to the agent's
        workspace, the shared folder, temporary folders and any extra folders you have allowed. It does not block all
        file reads or network access. The settings explain which restrictions the selected provider and operating system
        support.
      </p>
      <p>
        Ask first keeps approval requests for OpenBot tools and site publishing visible, along with requests from the
        provider. Full access lets the agent act without routine approvals and change files your operating-system
        account can reach. Questions, sign-in and some browser steps can still need your input. Computer Use and the
        OpenBot browser are not limited to the workspace; Computer Use has its own switch.
      </p>
      <p>
        What the application sends, and what it never sends, is written down in{" "}
        <a href={OPENBOT_LINKS.privacy} target="_blank" rel={EXTERNAL_LINK_REL}>
          the privacy document
        </a>
        .
      </p>
      <ArticleImage
        src={agentPermissions}
        alt="Agent Permissions with the Access menu open, showing Workspace only, Ask first and Full access."
        width={724}
        height={1184}
        mountOn="How to Use OpenBot: Set Up Your First AI Agent"
        caption="The Access menu sets the permissions for this agent. Computer Use has its own switch below."
      />

      <h2>Channels: more than one agent on one thing</h2>
      <p>
        A channel brings several agents into one conversation. You can address one agent, ask several for their views,
        or ask a coordinator to divide the work and combine the results. Each assigned task has an owner, and the
        assignments and results appear in the conversation.
      </p>
      <p>
        Give the agents distinct jobs: one drafts, one checks the sources, and one coordinates the work. Ask the
        coordinator to assign each part and combine the results. A message that mentions another agent is not always an
        assignment to start work.
      </p>
      <p>
        You can stop a task, then choose <strong>Continue</strong>, <strong>Reassign</strong> or{" "}
        <strong>Cancel task</strong> on its stopped-task card. <strong>Delete channel</strong> moves a channel to{" "}
        <strong>Deleted channels</strong>, where you can preview it or choose <strong>Restore channel</strong>.
      </p>
      <ArticleImage
        src={aChannel}
        alt="A channel called Launch room. Chief assigns the release note to Launch, Research reports which performance claims it could verify, and Launch posts the finished draft as a linked file."
        width={2400}
        height={1090}
        mountOn="How to Use OpenBot: Set Up Your First AI Agent"
        caption="One conversation shows who took each task and the results they returned."
      />
      <p>
        Agents can also exchange updates outside a channel. In the Developer chat below, the agent receives an update
        from Boss and reports what it changed and what still blocks publication.
      </p>
      <ArticleImage
        src={agentCollaboration}
        alt="Developer's chat showing a message from Boss, updates about a page built from shared files, and a report sent to Boss and Designer."
        width={1587}
        height={991}
        mountOn="How to Use OpenBot: Set Up Your First AI Agent"
        caption="The Developer chat shows messages between agents, links to shared files and the latest status."
      />

      <h2>Routines: the work that repeats</h2>
      <p>
        A routine repeats an instruction on a schedule. It can run in the agent's main chat or in a separate thread.
        Each run starts a fresh provider session with selected recent conversation history. Its result and run history
        remain available for you to check.
      </p>
      <p>
        Make “nothing to report” an acceptable result when there is no new information. The computer or server running
        OpenBot needs to be available when the routine runs.
      </p>
      <ArticleImage
        src={aRoutine}
        alt="A routine in a thread. Two invoked routine markers sit above their instructions, and a side panel shows the schedule, on weekdays at 9:00 AM, with a successful run yesterday."
        width={1696}
        height={664}
        mountOn="How to Use OpenBot: Set Up Your First AI Agent"
        caption="The thread marks which turns a routine started, so a scheduled answer never reads as one you asked for."
      />

      <h2>Your team, on your own computer</h2>
      <p>
        You can invite people to connect to the same OpenBot computer or server. Sharing access does not start a second
        instance. Chats and files travel through an encrypted connection to that computer, directly when possible or
        through an encrypted relay. For this connection, Signal handles the setup.
      </p>
      <p>
        OpenBot's account service stores account details, avatars, host configuration, memberships, invitations and
        logical session records. Its database does not store the chats, files or commands sent through the connection to
        your OpenBot computer or server.
      </p>

      <h2>What is next</h2>
      <p>
        <Link to="/news">The news section</Link> is where I write about the decisions behind these parts.{" "}
        <Link to="/guides">The guides section</Link> is where the how-to pages collect. The{" "}
        <a href={OPENBOT_LINKS.repository} target="_blank" rel={EXTERNAL_LINK_REL}>
          repository
        </a>{" "}
        holds the code, and{" "}
        <a href={OPENBOT_LINKS.releases} target="_blank" rel={EXTERNAL_LINK_REL}>
          the releases page
        </a>{" "}
        holds every build.
      </p>
      <p>If a step does not match what you see, tell me which OpenBot version you are using and where you got stuck.</p>
    </>
  );
}
