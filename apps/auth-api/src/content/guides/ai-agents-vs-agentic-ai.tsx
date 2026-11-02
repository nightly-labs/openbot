import { Link } from "@tanstack/solid-router";

export function AIAgentsVsAgenticAI() {
  return (
    <>
      <p>
        An AI agent is something you can give a job to.{" "}
        <Link to="/guides/$slug" params={{ slug: "agentic-ai-definition" }}>
          Agentic AI
        </Link>{" "}
        describes how it works when it can take steps toward that job, use tools and adjust its next step based on what
        it finds. The terms sound similar because they describe two sides of the same task: the worker and the way the
        work gets done.
      </p>

      <p>
        OpenBot makes the difference easy to see. You can create a named agent, give it instructions and keep its
        conversations and files in its own workspace. What happens after you assign a task shows how much of its work is
        agentic.
      </p>

      <h2>One OpenBot task, two terms</h2>

      <p>
        Suppose you want to compare three project-management tools for your team. You ask an OpenBot research agent to
        check their official pages and save a short comparison with links.
      </p>

      <p>The research agent is the AI agent. It has a role, instructions and a place to keep its work.</p>

      <p>
        Now imagine that one pricing page does not explain a team limit. The agent opens the vendor's help page, checks
        the missing detail and marks anything it still cannot confirm. Choosing that next step from what it found is
        agentic behavior.
      </p>

      <p>
        You should still read the comparison before making a purchase. Agentic AI can move the research forward; it does
        not make every finding correct.
      </p>

      <h2>Does every AI agent work this way?</h2>

      <p>
        Not to the same degree. One agent might follow a set sequence: read these pages, fill in this table and stop.
        Another might decide which source to check next when the first page is incomplete. Both may be called AI agents,
        but the second has more room to adapt.
      </p>

      <p>
        The label alone tells you very little. Ask what the agent can actually do: Can it open the sources you approve?
        Can it save a file you can inspect? Will it show where a claim came from and say when it cannot verify one? Can
        you review its result before anything is sent or published?
      </p>

      <p>
        In OpenBot, the agent's workspace and conversation stay on the computer running OpenBot. A connected AI provider
        may still receive the prompts needed to carry out the task, and the browser and other tools may use the network.
        Those details matter more than whether a product calls itself “agentic.”
      </p>

      <h2>Do you need several agents?</h2>

      <p>
        No. One OpenBot agent can research and save the comparison. If the work grows, you can ask a second agent to
        review the evidence or turn the approved notes into a report. OpenBot supports messages, shared files and
        handoffs between agents, but adding more agents does not automatically improve the answer.
      </p>

      <p>
        Use separate agents when their jobs are genuinely different. Keep a clear owner for the final result and let a
        person review important decisions.
      </p>

      <h2>A small task to try</h2>

      <p>
        Give one OpenBot agent a narrow request: “Compare these three approved product pages. Save a table with the
        price, team limit and a link for each fact. If a detail is missing, mark it as unknown. Do not send or publish
        the result.”
      </p>

      <p>
        Then read the file. If the agent found a missing detail and chose a useful next source, you have seen agentic
        behavior in practice. If it guessed, update the instructions and review process before trusting it with a larger
        task.
      </p>

      <h2>Frequently asked questions</h2>

      <h3>Is agentic AI a special model?</h3>
      <p>
        Usually the term describes a way of working with a model, instructions and tools. It does not tell you which
        model the product uses.
      </p>

      <h3>Can a single agent be agentic?</h3>
      <p>Yes. It can choose its next step based on what happens. A team of agents is not required.</p>

      <h3>What is the useful distinction?</h3>
      <p>
        “AI agent” names the worker. “Agentic AI” describes the ability to keep working toward a goal across steps.
        Judge both by the output you can check, not by the label.
      </p>
    </>
  );
}
