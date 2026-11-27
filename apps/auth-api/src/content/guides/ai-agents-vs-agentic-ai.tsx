import { Link } from "@tanstack/solid-router";

export function AIAgentsVsAgenticAI() {
  return (
    <>
      <p>
        <strong>The short answer:</strong> an AI agent is a thing, and agentic AI is a way of working. An{" "}
        <Link to="/guides/$slug" params={{ slug: "what-are-ai-agents" }}>
          AI agent
        </Link>{" "}
        is a program that you give a job to: it has a role, instructions, tools and a place to keep its work.{" "}
        <Link to="/guides/$slug" params={{ slug: "agentic-ai-definition" }}>
          Agentic AI
        </Link>{" "}
        describes AI that plans its own steps toward a goal, uses tools, checks the result and changes its next step
        when something is not as expected.
      </p>

      <p>
        Most AI agents use agentic AI, but not all to the same degree. And agentic AI can also work without a named
        agent, for example inside one long chat. The terms are used together because they describe two sides of the same
        task: the worker and the way the work gets done.
      </p>

      <h2>Agentic AI vs AI agents: the key differences</h2>

      <table>
        <thead>
          <tr>
            <th>Topic</th>
            <th>AI agent</th>
            <th>Agentic AI</th>
          </tr>
        </thead>
        <tbody>
          <tr>
            <td>What it is</td>
            <td>A worker: a program with a role and tools.</td>
            <td>A property: the ability to act across several steps.</td>
          </tr>
          <tr>
            <td>Part of speech</td>
            <td>A noun. You can name it, start it and stop it.</td>
            <td>An adjective. It describes how a system behaves.</td>
          </tr>
          <tr>
            <td>Main question</td>
            <td>Who does the job?</td>
            <td>How much does it decide by itself?</td>
          </tr>
          <tr>
            <td>Scope</td>
            <td>One agent, or a team of agents with separate roles.</td>
            <td>Any AI system that plans, acts and corrects itself.</td>
          </tr>
          <tr>
            <td>Example</td>
            <td>A research agent with instructions and a folder for its notes.</td>
            <td>The same agent opens a second source when the first page is missing a fact.</td>
          </tr>
          <tr>
            <td>What to check</td>
            <td>Its role, tools, permissions and where its work is saved.</td>
            <td>Its plan, the steps it took and the evidence for each result.</td>
          </tr>
        </tbody>
      </table>

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

      <h2>Is every AI agent agentic?</h2>

      <p>
        Not to the same degree. One agent might follow a set sequence: read these pages, fill in this table and stop.
        Another might decide which source to check next when the first page is incomplete. Both may be called AI agents,
        but the second has more room to adapt. You can think of it as a scale, from a fixed script to an agent that
        plans most of its own steps.
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

      <h2>How do agentic AI, AI agents and chatbots compare?</h2>

      <p>
        A chatbot answers one message at a time and waits for you. An AI agent has a job, tools and memory of its
        earlier work. Agentic AI is what lets the agent move from step to step without a new prompt each time. For the
        difference between agentic AI and a chatbot in more detail, read the{" "}
        <Link to="/guides/$slug" params={{ slug: "agentic-ai-definition" }}>
          agentic AI definition
        </Link>
        .
      </p>

      <h2>Do you need several agents?</h2>

      <p>
        No. One OpenBot agent can research and save the comparison. If the work grows, you can ask a second agent to
        review the evidence or turn the approved notes into a report. OpenBot supports messages, shared files and
        handoffs between agents, but adding more agents does not automatically improve the answer.
      </p>

      <p>
        Use separate agents when their jobs are genuinely different. Keep a clear owner for the final result and let a
        person review important decisions. For examples of teams that split work this way, read{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-agent-workflows" }}>
          AI agent workflows
        </Link>
        .
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

      <h3>What is the difference between AI agents and agentic AI?</h3>
      <p>
        “AI agent” names the worker. “Agentic AI” describes the ability to keep working toward a goal across steps. An
        AI agent is agentic when it plans, acts and corrects itself with little help.
      </p>

      <h3>Is agentic AI a special model?</h3>
      <p>
        Usually the term describes a way of working with a model, instructions and tools. It does not tell you which
        model the product uses.
      </p>

      <h3>Can a single agent be agentic?</h3>
      <p>Yes. It can choose its next step based on what happens. A team of agents is not required.</p>

      <h3>Is agentic AI better than an AI agent?</h3>
      <p>
        They are not alternatives. You use an AI agent, and agentic AI describes how much of the work it can do without
        you. Judge both by the output you can check, not by the label.
      </p>
    </>
  );
}
