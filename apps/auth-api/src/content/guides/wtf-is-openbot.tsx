export function WtfIsOpenBot() {
  return (
    <>
      <p>
        At first glance, OpenBot might look like another app for chatting with AI. But it is not a model or a chatbot on
        its own. It is a workspace that brings the models and agents you already use into one place, together with their
        files, conversations, and context.
      </p>
      <p>To understand how it works, it helps to separate those pieces first.</p>

      <h2>OpenBot Is Not a Model</h2>
      <p>
        OpenBot does not create its own AI model. It also does not replace tools like Codex, Claude Code, Grok CLI,
        OpenCode, or models that you host yourself.
      </p>
      <p>
        The model is the part that generates the response. Its output depends on its training, the instructions it
        receives, the context around the task, and the tools or files it can access.
      </p>
      <p>
        Codex, Claude Code, Grok CLI, OpenCode, and similar tools act as provider integrations or runtimes. They connect
        OpenBot to a model and handle the communication, authentication, and provider-specific parts of the process.
      </p>
      <p>
        OpenBot is the workspace around that process. It gives agents a role, a workspace, a conversation, a queue, and
        a way to keep context, exchange files, and work with other agents.
      </p>

      <h2>Model, Provider, Agent: What’s the Difference?</h2>
      <p>A model generates the response.</p>
      <p>
        A provider integration or runtime connects that model to OpenBot. It can be Codex, Claude Code, Grok CLI,
        OpenCode, or another configured runtime.
      </p>
      <p>
        An agent is the persistent setup built around that connection. It has its own role, instructions, workspace,
        conversation, queue, and context.
      </p>
      <p>
        This means the model and the agent do not have to be the same thing. You can move an agent from one provider
        integration to another while keeping the work around it in place.
      </p>
      <p>
        For example, a research agent might use Claude for one task and Codex for another. The model may change, but the
        agent’s role, files, and conversation can remain the same.
      </p>
      <p>
        That is what makes an agent different from a saved prompt. It carries the work around the task, not just the
        instructions for answering it.
      </p>

      <h2>What an Agent Actually Owns</h2>
      <p>
        An agent in OpenBot is more than a name attached to a model. It is a persistent setup for a particular kind of
        work.
      </p>
      <p>
        It has its own identity, instructions, workspace, conversation, queue, and provider session. The workspace is
        where it works with files, while the conversation keeps a record of what has already happened.
      </p>
      <p>
        Even when you change the provider, the agent can keep working with the same files, conversation, and context.
      </p>
      <p>This setup becomes more useful when the work continues over time or has to go through several stages.</p>

      <h2>Where the Work Happens</h2>
      <p>
        OpenBot runs on your computer, so an agent’s workspace is a local folder rather than a chat that disappears when
        you close a browser tab. Its conversations, queues, attachments, and other app data stay with the desktop app
        and the machine that hosts it.
      </p>
      <p>
        That does not mean every part of the process stays local. When an agent uses Codex, Claude, Grok, or another
        provider, prompts, files, and tool results may be sent to that provider. The embedded browser also uses the
        network.
      </p>
      <p>
        Local-first describes where OpenBot keeps your project and agent state. It does not mean that the entire setup
        has to work offline.
      </p>
      <p>
        You can also keep OpenBot running on one computer, such as a Mac mini, and connect to it from other devices. The
        host remains the place where the agents and their workspaces live, while the other devices give you a way to
        follow the work.
      </p>

      <h2>A Task From Start to Finish</h2>
      <p>Imagine asking a research agent to prepare a short report.</p>
      <p>
        You give it the task in its conversation, and OpenBot runs it with the agent’s instructions, workspace, context,
        and selected provider. The agent can inspect local files, use the embedded browser, save notes, and return the
        result in the same thread.
      </p>
      <p>
        When the first part is done, you can pass the work to another agent. A writing agent can use the research files,
        while a review agent checks the result and points out what needs to change.
      </p>
      <p>
        Each agent can keep its own role and conversation, while the project stays in one place. You can follow the work
        as it happens, send another instruction, pause a task, or redirect it when the plan changes.
      </p>
      <p>The models still do the actual work. OpenBot keeps the tasks, files, conversations, and handoffs connected.</p>

      <h2>Why Use More Than One Agent?</h2>
      <p>
        One agent can handle a lot of work, but one setup is not always the best fit for every task. Research, coding,
        writing, and review often need different instructions, tools, and ways of working.
      </p>
      <p>Instead of asking one assistant to change roles constantly, you can give each agent a more focused job.</p>
      <p>
        OpenBot lets agents exchange messages and files, pass work between their conversations, and work together in
        shared channels. A research agent can gather information, a writing agent can turn it into a draft, and a review
        agent can check the result.
      </p>
      <p>
        More agents do not automatically make a task better. For a quick question, one agent may be enough. A larger
        setup becomes useful when the work has clear stages, needs different perspectives, or has to continue over time.
      </p>

      <h2>Who Is OpenBot Actually Built For?</h2>
      <p>
        OpenBot is for people who want AI work to continue beyond a single answer. It makes the most sense when a task
        involves files, ongoing context, repeated steps, or more than one role.
      </p>
      <p>
        A developer might keep a coding agent next to a research or review agent. A content team might use one agent for
        research, another for drafts, and another for feedback.
      </p>
      <p>An individual might keep an agent running recurring tasks instead of rebuilding the same setup every time.</p>
      <p>
        If you only need a quick answer, a regular chatbot may be faster. OpenBot becomes useful when the work starts to
        look more like a project than a conversation.
      </p>
      <p>
        It is also worth remembering that OpenBot is still a development preview. Agents can access files, run commands,
        use the network, and control the browser, so you should only give them tasks you trust and keep backups of
        important work.
      </p>

      <h2>More Than a Chat Window</h2>
      <p>
        OpenBot is not a model and not just another chat app. It is a local-first workspace that keeps agents, models,
        files, conversations, and tasks connected.
      </p>
      <p>
        The model provides the responses. The provider integration connects it to OpenBot. The agent keeps the work
        around the task. OpenBot brings these pieces together so you can keep working instead of starting from a blank
        chat each time.
      </p>
      <p>That is the idea behind OpenBot: turning separate AI tools into persistent teammates for real work.</p>
      <p>If you want to see how it works in practice, start with OpenBot 101.</p>
    </>
  );
}
