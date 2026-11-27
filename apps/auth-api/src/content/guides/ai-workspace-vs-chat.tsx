import { Link } from "@tanstack/solid-router";

export function AIWorkspaceVsChat() {
  return (
    <>
      <p>
        A long chat can show how a report was written. An AI agent workspace gives you a place to keep the report
        itself, the brief and the sources behind it. The difference becomes useful when you return to the same job next
        week.
      </p>

      <p>
        In OpenBot, an agent has both a working folder and a saved conversation. You can discuss the work in chat, ask
        the agent to save the result, and return to those files for the next task.
      </p>

      <p>Here is what that changes in a recurring research project.</p>

      <h2>Chat history and workspace files do different jobs</h2>

      <p>
        Chat history records your requests, the agent's answers and the discussion between them. It helps explain why
        you chose one option over another.
      </p>

      <p>
        Workspace files give you a clear place for the current brief, source notes and finished report. You can ask the
        agent to open and update a named file instead of finding the right version among several replies.
      </p>

      <p>
        Chat apps can also offer files and project features. This comparison is about how you organize the work: mainly
        through messages, or through messages plus clearly named project files.
      </p>

      <h2>An example: updating a software comparison</h2>

      <p>
        Suppose you ask an agent to compare three tools for your team. You discuss the budget, change the criteria and
        ask for two revisions.
      </p>

      <p>
        If you leave everything in the conversation, the latest answer may be clear today. Next week, you may need to
        check which version you approved and which earlier suggestions you rejected.
      </p>

      <p>In OpenBot, you can ask the agent to save four files in its workspace:</p>

      <ul>
        <li>
          <code>brief.txt</code> — who the comparison is for and what matters.
        </li>
        <li>
          <code>sources.txt</code> — source links, checked dates and facts that need another check.
        </li>
        <li>
          <code>report.txt</code> — the report you are reviewing.
        </li>
        <li>
          <code>decisions.txt</code> — your accepted choices and reasons for excluding an option.
        </li>
      </ul>

      <p>
        These are suggested filenames, not files OpenBot creates automatically. Ask the agent to create them and review
        their contents before treating them as the agreed project record.
      </p>

      <h2>Returning to the task next week</h2>

      <p>Your next request can point to that record:</p>

      <blockquote>
        <p>
          Read <code>brief.txt</code>, <code>decisions.txt</code> and <code>report.txt</code>. Recheck the product facts
          in <code>sources.txt</code> against current official sources. Save an updated report as a new dated file, keep
          the previous report, and list what changed. Flag anything you could not verify.
        </p>
      </blockquote>

      <p>
        The agent has a clear starting point: the current requirements, the previous result and the decisions you
        already made. You can review the changes before accepting the new report.
      </p>

      <p>
        OpenBot keeps the conversation too. Saved files give you another way to identify the current result; they do not
        replace the discussion that led to it.
      </p>

      <p>
        Saving a file does not mean the agent reads every project file on every task. Name the files it should read,
        especially after a long gap or a change of model.
      </p>

      <h2>Changing the model while keeping the work</h2>

      <p>
        You can change the AI provider an agent uses, such as moving from Claude to ChatGPT. The agent keeps its name,
        saved conversation and workspace files. You might use one provider for research and another to revise the same
        report.
      </p>

      <p>
        The new model does not automatically receive the whole earlier conversation. OpenBot passes along selected
        parts, and the agent can look up more of its saved history when needed. Some details of the old provider's work
        do not transfer.
      </p>

      <p>
        A short brief and a saved report help you make the next instruction specific: "Read these files, check the
        sources and revise this section."
      </p>

      <h2>Passing the report to another OpenBot agent</h2>

      <p>
        Agents on the same OpenBot computer or server can use its shared folder for files they need to work on together.
        They can also send messages with files attached. A channel gives the team a place to discuss the shared task.
      </p>

      <p>
        For example, one agent can collect sources, another can draft the report, and a third can review it. The request
        to the reviewer should include the brief, the report and the checks you want it to make.
      </p>

      <p>
        Sharing a file does not automatically share an agent's entire private conversation or memories. Include the
        context the next agent needs.
      </p>

      <p>
        Choose one agent to update the main report. Ask the others to return separate research or review files so that
        several agents do not overwrite the same document.
      </p>

      <p>
        The working files live on the computer or server running that OpenBot instance. Connecting from your phone does
        not turn its shared folder into a folder synchronized across all your devices.
      </p>

      <h2>What a workspace does not fix</h2>

      <p>
        A saved source can still be out of date. A report can still contain a mistake. Ask for fresh checks, keep
        earlier versions you need, and read the result before using or publishing it.
      </p>

      <p>
        A folder also does not decide what an agent can access. OpenBot's Workspace only setting, for supported
        providers, limits writes to allowed folders; it does not block file reads or network access. Full access is a
        separate setting.
      </p>

      <p>
        This example describes a workflow you can try, not a measured time saving. Its value depends on whether the
        files stay clear and current and whether the agent actually uses them.
      </p>

      <p>
        For more tasks to try, see our{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-agents-examples" }}>
          AI agent examples
        </Link>
        .
      </p>

      <h2>Frequently asked questions</h2>

      <h3>Should I stop using chat?</h3>

      <p>
        No. Use chat for instructions, questions and feedback. Use files for the brief, source notes and results you
        want to return to.
      </p>

      <h3>What should I save first?</h3>

      <p>
        Start with the agreed brief and the latest report. Add source notes and decisions when the project needs them.
      </p>

      <h3>
        Is <code>report.txt</code> automatically approved when the agent saves it?
      </h3>

      <p>
        No. In this example, approval is your review decision. Ask the agent to keep the previous file and save a new
        version before making changes you may want to undo.
      </p>
    </>
  );
}
