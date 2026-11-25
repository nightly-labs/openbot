import { Link } from "@tanstack/solid-router";

export function AIAgentProductivity() {
  return (
    <>
      <p>
        You ask an agent to prepare a client update. It gets the facts mostly right, but you spend time explaining the
        format, correcting a project name and reminding it which work is still waiting for approval.
      </p>

      <p>
        The next week, those same explanations can become part of the work again. A persistent OpenBot agent gives you a
        place to keep the instructions and project files for the next update. Whether that improves productivity depends
        on how well it uses them and how much checking the result still needs.
      </p>

      <h2>A weekly client update</h2>

      <p>
        Suppose you send a short project update every Friday. The client wants completed work, current blockers and the
        next agreed step. They prefer a few plain paragraphs.
      </p>

      <p>
        Give one OpenBot agent that responsibility. Ask it to save the format, the current project brief and the last
        update you accepted. Keep links to the project notes or issues it should use for fresh information.
      </p>

      <p>For the next update, your request can point to those files:</p>

      <blockquote>
        <p>
          Read the project brief and last week's approved update. Check the current project notes. Draft this week's
          update in the same format. Flag any status you cannot confirm and save it as a new dated file for me to
          review.
        </p>
      </blockquote>

      <p>
        The agent has a clear starting point. You can spend your review checking this week's facts and whether the
        message is ready for the client.
      </p>

      <h2>Make a correction useful next time</h2>

      <p>
        If the agent uses the wrong project name, ask it to correct the brief as well as the draft. If the client wants
        a different format, update the instructions used for future reports.
      </p>

      <p>
        Keep changing facts with their sources and dates. A deadline, a price or a project's status may need another
        check next week. Stable preferences, such as the client's preferred wording, can stay in the instructions or the
        agent's saved memories.
      </p>

      <p>After making a correction, check the next result. A saved instruction helps only when the agent uses it.</p>

      <h2>Check whether you are doing less work</h2>

      <p>
        Compare a few similar updates. Keep the sources and expected standard consistent, then record how much time you
        spend preparing the request, checking the facts and making corrections.
      </p>

      <p>
        Look for concrete differences. Did you need to explain the format again? Did the agent use the current project
        name? Did it carry an old blocker into this week's draft after the issue was resolved?
      </p>

      <p>
        Include the time spent setting up the project files. If you spend more effort maintaining them than they save,
        simplify the instructions or choose a task that repeats more often.
      </p>

      <p>
        A report that arrives quickly but takes extensive rewriting still needs work. Count the result you are
        comfortable sharing.
      </p>

      <h2>Keep current information easy to find</h2>

      <p>
        OpenBot keeps an agent's workspace files and stored conversations across restarts. You can return to the same
        agent for the next update and point it to the files that matter.
      </p>

      <p>
        Saving a project does not mean every detail is included in every answer. Tell the agent to read the current
        brief and the last accepted update. Check fresh facts against the current notes.
      </p>

      <p>
        If you start a new chat with the same agent, give it that starting point again. Earlier messages can be
        retrieved, and the working files remain available, but the new chat does not automatically contain every earlier
        exchange.
      </p>

      <h2>Add a second agent for a clear reason</h2>

      <p>
        A researcher can check a disputed fact or collect updates from the sources you specify. A reviewer can compare
        the draft with the brief and source notes.
      </p>

      <p>
        Give that agent the files and context it needs. Agents on the same OpenBot computer or server can use the shared
        folder or send files with a message. A handoff does not automatically include the first agent's private
        conversation or memories.
      </p>

      <p>
        Keep one agent responsible for updating the final draft. You can then read one version and decide which
        corrections to accept.
      </p>

      <h2>Keep the project when you change models</h2>

      <p>
        Changing an OpenBot agent's AI provider keeps the agent and its workspace files. Its saved conversation also
        stays available. The new provider receives selected parts of that history and can retrieve more when needed.
      </p>

      <p>
        Ask it to read the current brief and report before continuing. That gives the next session a clear task even
        when every detail of the earlier provider's work has not transferred.
      </p>

      <p>Start with one recurring job, keep the records simple and judge the setup by the work you can actually use.</p>

      <p>
        Read more about{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-workspace-vs-chat" }}>
          what stays in a workspace and what stays in chat history
        </Link>{" "}
        and{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-teammates-vs-ai-chatbots" }}>
          when a second agent can help
        </Link>
        .
      </p>
    </>
  );
}
