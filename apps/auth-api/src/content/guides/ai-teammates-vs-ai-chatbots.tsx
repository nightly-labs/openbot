import { Link } from "@tanstack/solid-router";

export function AITeammatesVsAIChatbots() {
  return (
    <>
      <p>
        A chat is enough when you need a quick explanation or a second opinion on a paragraph. When the same project
        needs research, writing and review, it helps to give each part a clear owner. In OpenBot, you can give agents
        their own roles and pass work between them.
      </p>

      <p>
        AI teammates and AI chatbots can both work through a chat interface. The choice depends on what has to happen
        after the answer.
      </p>

      <h2>When one chat is enough</h2>

      <p>
        Say you have an onboarding email and want to make it clearer. Paste the draft, tell the assistant who will read
        it and ask for a rewrite. You can check the result in a few minutes and move on.
      </p>

      <p>
        If the same agent can handle the whole job and you can easily review its work, keep the setup simple. An ongoing
        project can also start with one OpenBot agent that keeps its{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-workspace-vs-chat" }}>
          conversation and workspace
        </Link>{" "}
        for later tasks.
      </p>

      <h2>When to give the work separate owners</h2>

      <p>
        Suppose your team maintains a customer onboarding guide. Each product update can change a step, a button name or
        a plan requirement. You need someone to find those changes, someone to update the guide and someone to check the
        result.
      </p>

      <p>Here is one way to divide that work in OpenBot:</p>

      <ol>
        <li>
          <strong>Researcher.</strong> Check the official release notes and help pages. Save a short list of confirmed
          changes, links and any questions that remain open.
        </li>
        <li>
          <strong>Writer.</strong> Read those findings and update the existing guide. Mark the sections that changed and
          keep uncertain details out of the draft until they are confirmed.
        </li>
        <li>
          <strong>Reviewer.</strong> Compare the updated guide with the source pages and the original brief. Return a
          list of corrections for the writer or flag the draft as ready for your review.
        </li>
      </ol>

      <p>
        Try it with two agents first. One can research and draft, while the other checks the result. Add a separate
        writer if the work regularly calls for that split.
      </p>

      <h2>Give the next agent a usable handoff</h2>

      <p>
        OpenBot agents can message each other and attach files. Agents on the same OpenBot computer or server can also
        use its shared folder. A channel gives participating agents a shared conversation for the task.
      </p>

      <p>
        When you ask the writer to pass a draft to a reviewer, include the brief, the draft, the source notes and the
        checks you want. The reviewer gets the material you pass along. The writer’s private chat and memories are
        separate from that handoff.
      </p>

      <p>For example, a review request could say:</p>

      <blockquote>
        <p>
          Check the steps in the attached onboarding draft against the links in the research notes. Flag any button
          names or plan requirements you cannot verify. Return your findings and leave the draft file for the writer to
          update.
        </p>
      </blockquote>

      <p>
        Keep one agent responsible for editing the final file. That makes it clear who should apply corrections and
        which version you should read.
      </p>

      <h2>Choose based on the next step</h2>

      <p>
        Use a chat for a question or a quick edit. Use one persistent agent for recurring work that needs the same
        instructions and files. Split the work between agents when there is a clear reason to hand it off, such as
        checking a draft against its sources before it goes out.
      </p>

      <p>
        If the handoff takes more effort than reviewing the answer yourself, keep the task with one agent. The right
        setup is the one that gives you a result you can check.
      </p>
    </>
  );
}
