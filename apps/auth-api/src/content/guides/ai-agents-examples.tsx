import { Link } from "@tanstack/solid-router";

export function AIAgentsExamples() {
  return (
    <>
      <p>
        The best AI agent examples begin with a task you already do and end with a result you can check. That might be a
        research brief, a draft email, a proposed code change or a cleaned spreadsheet. You do not need to hand an agent
        the whole business to make it useful.
      </p>

      <p>
        In OpenBot, you can give an agent instructions, let it work with files and approved web pages, and return to the
        same conversation later. You can also pass work to another agent when a separate reviewer or writer helps. The
        20 examples below are tasks to try, not customer case studies or promises that every result will be correct.
      </p>

      <h2>Research and knowledge</h2>

      <ol>
        <li>
          <strong>Compare vendors.</strong> Ask a research agent to read three official pricing pages and save a table
          with prices, limits and links. Check the dates and any unclear terms before choosing a plan.
        </li>
        <li>
          <strong>Track documentation changes.</strong> Give an agent last month's saved documentation and the current
          pages. Ask for a short list of additions, removals and changed instructions, with links you can open.
        </li>
        <li>
          <strong>Prepare for a meeting.</strong> Supply the agenda and your notes. Ask the agent for a one-page brief
          with open questions. Check that it labels guesses as guesses.
        </li>
        <li>
          <strong>Answer a question from approved files.</strong> Give the agent a policy or product guide and ask it to
          point to the passage behind each answer. If the files disagree, the result should show the conflict.
        </li>
        <li>
          <strong>Build a source brief.</strong> Ask the agent to collect claims, dates and source links about one
          topic. A writer can then use the saved brief without relying on an unsupported summary.
        </li>
      </ol>

      <h2>Content and marketing</h2>

      <ol start={6}>
        <li>
          <strong>Make a content brief.</strong> Provide the audience, topic and approved keyword list. Ask for an
          outline, reader questions and a source plan. Do not let the agent invent search-volume numbers.
        </li>
        <li>
          <strong>Refresh an old article.</strong> Give the agent the article and current release notes. Ask it to
          propose only the paragraphs that need an update and to list the facts you should check.
        </li>
        <li>
          <strong>Turn one approved article into other drafts.</strong> Ask for a newsletter introduction and two social
          posts. Read them before publishing; short versions can lose an important caveat.
        </li>
        <li>
          <strong>Check brand language.</strong> Save your style guide in the agent's workspace. Ask it to flag terms
          that do not match the guide and suggest exact edits, not a vague score.
        </li>
        <li>
          <strong>Summarize a campaign export.</strong> Give the agent an approved CSV file and define the metrics you
          need. Ask for a short report plus the calculations, then compare its totals with the file.
        </li>
      </ol>

      <h2>Software and product work</h2>

      <ol start={11}>
        <li>
          <strong>Investigate a bug.</strong> Give a coding agent the issue and access to the relevant repository. Ask
          it to reproduce the problem and save its findings before changing code.
        </li>
        <li>
          <strong>Review a proposed code change.</strong> Ask another agent to inspect a pull request and report
          specific problems with file locations and a failure scenario. A person still decides which comments are valid.
        </li>
        <li>
          <strong>Update instructions after a code change.</strong> Ask the agent to compare a merged change with setup
          documentation and propose a documentation patch. Run any changed steps yourself before publishing them.
        </li>
        <li>
          <strong>Draft release notes.</strong> Give the agent the merged changes and your writing style. Ask for notes
          that separate what has shipped from what is still planned.
        </li>
        <li>
          <strong>Plan a dependency update.</strong> Ask the agent to read the official migration guide, find affected
          code and list likely tests. Review the plan before it installs or changes anything.
        </li>
      </ol>

      <h2>Daily operations</h2>

      <ol start={16}>
        <li>
          <strong>Draft a support answer.</strong> Supply the customer's question and approved help material. Ask for a
          reply draft with any missing account details clearly marked. A support owner checks it before sending.
        </li>
        <li>
          <strong>Find possible duplicate contacts.</strong> Give the agent a CRM export, not write access to the live
          CRM. Ask for a list of record IDs that may match and the reason for each suggestion. You decide which records
          to merge.
        </li>
        <li>
          <strong>Write a weekly project update.</strong> Provide issue and document exports. Ask the agent to separate
          completed work, open work and items it could not verify.
        </li>
        <li>
          <strong>Check a data file.</strong> Ask the agent to find missing values, duplicate rows and dates in the
          wrong format. Keep the original file and review the proposed cleaned copy.
        </li>
        <li>
          <strong>Report unusual changes.</strong> Give the agent this week's figures and an accepted baseline. Ask it
          to show the biggest differences and say “no significant change” when that is the honest result.
        </li>
      </ol>

      <h2>Which example should you try first?</h2>

      <p>
        Pick a task whose answer you can check in a few minutes. Vendor research, an article update or a report from a
        small export are good starts. Give the OpenBot agent the input, the result you want, the sources it may use and
        the actions it must leave to you. Ask it to save a file and mark anything it cannot confirm.
      </p>

      <p>
        Start with one agent. If you later need a second opinion, another OpenBot agent can review the saved file or
        take a separate writing task. Your review remains the final step for important facts, messages, code changes and
        publishing.
      </p>

      <p>
        If you have not created an agent yet, start with{" "}
        <Link to="/guides/$slug" params={{ slug: "openbot-101" }}>
          How to Use OpenBot
        </Link>
        .
      </p>

      <h2>Frequently asked questions</h2>

      <h3>Do I need 20 agents for these tasks?</h3>
      <p>
        No. One agent can handle several related tasks. Add a specialist when its role makes the work easier to check.
      </p>

      <h3>Can an agent do all of this without my review?</h3>
      <p>
        It may do many steps, but important results still need a person to check facts and approve actions such as
        sending, merging or publishing.
      </p>

      <h3>How do I know whether a task helped?</h3>
      <p>
        Look at the accepted result, how much you had to correct and whether the agent showed its sources and
        uncertainties. A long activity log is not the same as useful work.
      </p>
    </>
  );
}
