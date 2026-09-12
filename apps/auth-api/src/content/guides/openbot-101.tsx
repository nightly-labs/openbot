import { Link } from "@tanstack/solid-router";
import { ArticleImage } from "../../components/content/ArticleMedia";
import { EXTERNAL_LINK_REL, OPENBOT_LINKS } from "../../lib/landing-links";
import aChannel from "./media/openbot-101/a-channel.webp";
import aRoutine from "./media/openbot-101/a-routine.webp";
import aThread from "./media/openbot-101/a-thread.webp";
import pickAModel from "./media/openbot-101/pick-a-model.webp";

export function OpenBot101() {
  return (
    <>
      <p>
        I built OpenBot because I wanted teammates, not chats. A chat window forgets. A teammate keeps the folder it
        works in, the history of what it did, and a name you can call it by. Tomorrow morning it is still those things,
        on a different model, after a restart.
      </p>
      <p>
        This is the page I would send someone who has never opened the app. It covers what OpenBot is, what an agent
        actually owns, and how to get one doing work you can check.
      </p>

      <h2>What OpenBot is</h2>
      <p>
        OpenBot is a desktop workspace for AI teammates that live on your computer. It runs the coding command-line
        tools you already use as processes on that machine:{" "}
        <a href={OPENBOT_LINKS.codex} target="_blank" rel={EXTERNAL_LINK_REL}>
          the Codex App Server
        </a>
        ,{" "}
        <a href={OPENBOT_LINKS.claude} target="_blank" rel={EXTERNAL_LINK_REL}>
          Claude Code
        </a>
        , Grok CLI and OpenCode. Each agent gets a workspace, a thread and an identity around them.
      </p>
      <p>
        Your work sits in a SQLite database called <code>openbot.db</code>, in the application's data folder. That file
        is the source of truth. Workspaces, conversations, attachments, browser data and team data stay on the computer
        that runs OpenBot.
      </p>
      <p>
        <strong>Local-first is not the same as offline.</strong> Codex still talks to OpenAI, Claude to Anthropic, Grok
        to xAI. Pages in the embedded browser use the network. A plugin can call its own service. What does not leave is
        the record of the work.
      </p>

      <h2>Anatomy of an agent</h2>
      <p>Four things belong to an agent. All four survive a restart and a change of model:</p>
      <ul>
        <li>
          <strong>A workspace.</strong> One directory of its own at <code>~/OpenBot/Agents/&lt;agent-id&gt;</code>. It
          also gets <code>~/OpenBot/Shared</code>, which is where agents hand files to each other.
        </li>
        <li>
          <strong>A thread.</strong> Everything you have asked the agent, and everything it did, in one durable record.
        </li>
        <li>
          <strong>An identity.</strong> A name, an avatar, a short role and the instructions you wrote for it.
        </li>
        <li>
          <strong>A private provider session.</strong> The resume state of the command-line tool behind it. That one
          belongs to the provider, so it is kept apart from the thread on purpose.
        </li>
      </ul>
      <p>
        That is why a model is just a setting. Move an agent from Codex to Claude and the workspace, the thread and the
        name stay put. Only the thinking changes.
      </p>
      <ArticleImage
        src={aThread}
        alt="An agent thread. Chief answers a launch question with a table of workstreams, owners and status, links the two working documents it read, and ends with a shell block."
        width={2400}
        height={1064}
        mountOn="OpenBot 101"
        caption="A thread is the answer and the work behind it: mentions of other agents, the files that were read, and the command it wants run next."
      />

      <h2>Install it, then connect a provider</h2>
      <p>
        OpenBot runs on macOS 13 or newer on Apple silicon, Windows 10 or newer on x64, and x64 Linux as an AppImage.
        Grab the installer from{" "}
        <a href={OPENBOT_LINKS.releases} target="_blank" rel={EXTERNAL_LINK_REL}>
          GitHub Releases
        </a>
        . The Windows preview is not code-signed yet, so Windows may warn about an unknown publisher. Check the release
        checksum before you run it. On Ubuntu 23.10 or newer and on Debian 13, the AppImage needs an AppArmor profile
        first.{" "}
        <a href={OPENBOT_LINKS.documentation} target="_blank" rel={EXTERNAL_LINK_REL}>
          The README
        </a>{" "}
        has the two commands that install it.
      </p>
      <p>
        Then pick a provider. In onboarding, in Settings or in the model picker, select one and press{" "}
        <strong>Download</strong>. OpenBot installs and pins its own managed copy of that command-line tool. If you
        already installed the tool yourself and there is no managed copy, OpenBot uses yours.
      </p>
      <p>
        <strong>OpenBot uses the login the command-line tool already has.</strong> It does not copy your provider
        credentials. If <code>codex</code> or <code>claude</code> works in your terminal, it works here.
      </p>
      <ArticleImage
        src={pickAModel}
        alt="The model picker open on the ChatGPT tab, showing the installed Codex CLI version, a list of GPT models, and a reasoning effort control."
        width={1440}
        height={1484}
        mountOn="OpenBot 101"
        caption="The picker names the command-line tool and its version, so you can see which binary an answer came from."
      />

      <h2>Your first task</h2>
      <p>
        Make the first one small, specific and checkable. “Improve my project” gets you an essay. “Read the failing test
        in this file and tell me which claim it disproves” gets you something you can agree or disagree with.
      </p>
      <p>
        Then look at the activity under the answer, not only the answer. The thread shows the files the agent opened and
        the commands it ran. That is how you tell whether it did the work or described it.
      </p>

      <h2>Full access, and what that means</h2>
      <p>
        OpenBot is a development preview. After you consent once at first launch, agents run with{" "}
        <code>danger-full-access</code> and <code>approvalPolicy: never</code>. They can read and change files, run
        commands, use the network and drive the embedded browser without asking again for each action.
      </p>
      <p>
        <strong>This is a product decision, not a security boundary.</strong> An agent starts in its own workspace, but
        these provider modes are unrestricted on purpose. They can reach outside that workspace wherever the operating
        system allows. Run agents and tasks you trust, and keep backups.
      </p>
      <p>
        What the application sends, and what it never sends, is written down in{" "}
        <a href={OPENBOT_LINKS.privacy} target="_blank" rel={EXTERNAL_LINK_REL}>
          the privacy document
        </a>
        .
      </p>

      <h2>Channels: more than one agent on one thing</h2>
      <p>
        A channel is a shared thread that several agents read and write. One agent owns the task at a time, and it hands
        the task on explicitly. You keep the controls: Stop, Resume, Reassign, Archive and Restore.
      </p>
      <p>
        It works best when the agents are different from each other. One drafts, one verifies, one owns the release
        date. Three copies of the same agent give you three copies of the same paragraph.
      </p>
      <ArticleImage
        src={aChannel}
        alt="A channel called Launch room. Chief assigns the release note to Launch, Research reports which performance claims it could verify, and Launch posts the finished draft as a linked file."
        width={2400}
        height={1090}
        mountOn="OpenBot 101"
        caption="One room, one task owner. The handover is a message, so you can read who took the work and why."
      />

      <h2>Routines: the work that repeats</h2>
      <p>
        A routine is one instruction plus the times to run it. The agent does the work in its own thread, so the result
        lands where the context already is, and the run history sits beside it.
      </p>
      <p>
        Size the instruction so that “nothing to report” is a normal answer. A routine that must always find something
        will always invent something.
      </p>
      <ArticleImage
        src={aRoutine}
        alt="A routine in a thread. Two invoked routine markers sit above their instructions, and a side panel shows the schedule, on weekdays at 9:00 AM, with a successful run yesterday."
        width={1696}
        height={664}
        mountOn="OpenBot 101"
        caption="The thread marks which turns a routine started, so a scheduled answer never reads as one you asked for."
      />

      <h2>Your team, on your own computer</h2>
      <p>
        You can invite people to your OpenBot instead of copying it. Publishing never starts a second instance. The Team
        API stays on loopback, and a hidden sandboxed page connects invited clients over WebRTC. Signal only carries the
        connection setup.
      </p>
      <p>
        Cloudflare holds accounts, avatars, host configuration, memberships, invitations and logical session records. It
        does not carry chats, files or commands. An account is optional. OpenBot works without one.
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
      <p>
        If something here is wrong, or a step does not match what you see, tell me. A preview is easier to correct than
        a release.
      </p>
    </>
  );
}
