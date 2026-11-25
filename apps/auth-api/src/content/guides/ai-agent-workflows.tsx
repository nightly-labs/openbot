import { Link } from "@tanstack/solid-router";

export function AIAgentWorkflows() {
  return (
    <>
      <p>
        Your product gets an update. Now someone needs to check what changed, update the help guide, prepare a customer
        message and review it all before publishing.
      </p>

      <p>
        In OpenBot, you can set up a small team of agents to help with those jobs. One checks the facts, another writes,
        and a third reviews the result. You can keep using that team for new tasks and ask it to reuse the research you
        have already approved.
      </p>

      <p>
        The twelve AI agent workflows below show what that can look like in everyday work. Here, a workflow simply means
        a set of steps you can use again for a similar task.
      </p>

      <h2>Set up your team</h2>

      <h3>Give each agent a job</h3>

      <p>
        One possible setup uses four agents, all on the same OpenBot computer or server. Choose a name for each and
        describe its job in its instructions:
      </p>

      <ul>
        <li>
          <strong>Coordinator</strong> takes your request, gives each agent its task and brings the finished work back
          to you.
        </li>
        <li>
          <strong>Researcher</strong> checks the sources you provide, saves useful facts with links and points out
          anything it cannot confirm.
        </li>
        <li>
          <strong>Writer</strong> turns your request and the research into a draft, then makes the changes you approve.
        </li>
        <li>
          <strong>Reviewer</strong> checks the draft against your request and the sources, then lists corrections or
          questions.
        </li>
      </ul>

      <p>
        These names are suggestions for agents you create yourself. You can start with one agent for a simple task and
        add the others when you need to split the work.
      </p>

      <p>
        For coding tasks, you can also add an <strong>Engineer</strong> with access to your code and the tools it needs.
        The other agents can help explain the changes and update the documents.
      </p>

      <h3>Bring them into one channel</h3>

      <p>
        Create a project channel: a conversation where you and your agents can work together. Add your agents, then
        choose <strong>Make channel lead</strong> for the Coordinator in the channel's member settings.
      </p>

      <p>
        When you want the Coordinator to manage a whole task, address it by name and ask it to assign the other agents
        their parts. Setting a channel lead alone does not tell it which work to assign.
      </p>

      <h3>Keep the project files together</h3>

      <p>
        Ask the Coordinator to create a project folder in OpenBot's shared folder on that computer or server. Use it for
        your task description, research, draft and review notes.
      </p>

      <p>
        When it assigns work, ask the Coordinator to tell each agent where that folder is and which files to use. The
        agents have separate private chats and memories, so explain what the next agent needs to know.
      </p>

      <p>
        Let Writer update the main draft. Have Reviewer put its comments in a separate file, so you can tell the draft
        and review apart.
      </p>

      <h3>Try one complete task</h3>

      <p>Send a request like this in the channel:</p>

      <blockquote>
        <p>
          @Coordinator, help me update our onboarding guide using the official release notes. Ask Researcher to check
          what changed, Writer to update the guide, and Reviewer to check the draft against the sources. Give each agent
          the shared project folder and the files it needs. If Reviewer finds mistakes, ask Writer to fix them. Send me
          the revised draft and any unanswered questions before anything is published.
        </p>
      </blockquote>

      <p>Once that works, use the same team for other jobs. You do not need every agent for every task.</p>

      <h2>1. Check documentation changes</h2>

      <p>
        Ask Researcher to compare the official documentation with your previous notes. It saves a dated summary and
        source links. Writer can turn confirmed changes into an internal update, and Reviewer checks the passages that
        matter.
      </p>

      <h2>2. Refresh a tool comparison</h2>

      <p>
        Researcher rechecks the official pricing and feature pages. Writer updates your comparison and lists what
        changed. Reviewer checks plan names, prices and unresolved details before the Coordinator returns the table to
        you.
      </p>

      <h2>3. Update answers to common questions</h2>

      <p>
        Give the team your existing FAQ, company rules and questions people keep asking. Researcher finds the relevant
        information, Writer proposes answers, and Reviewer checks them. The person responsible for those rules approves
        the final wording.
      </p>

      <h2>4. Plan your next article</h2>

      <p>
        Tell the team who the article is for and what it should help them do. Include any search terms you want to
        cover. Researcher gathers sources and reader questions, Writer prepares an outline, and Reviewer checks whether
        it repeats an existing article or misses an important question.
      </p>

      <h2>5. Check a published article for old facts</h2>

      <p>
        Researcher compares the article with current official sources and release notes. Writer updates the outdated
        passages, and Reviewer checks the new wording against the sources. The Coordinator sends you the revised draft
        for approval.
      </p>

      <h2>6. Turn an article into social drafts</h2>

      <p>
        Give Writer an approved article and the limits for each post. It drafts posts around specific examples from the
        article. Reviewer checks the meaning, links and character count before the posts come back to you.
      </p>

      <h2>7. Investigate a GitHub issue</h2>

      <p>
        For a software problem reported on GitHub, give Engineer access to the project code, the report and any error
        messages. Ask it to try to reproduce the problem and record what it tried. The Coordinator can summarize the
        findings and suggest the next step.
      </p>

      <h2>8. Review a pull request</h2>

      <p>
        A pull request is a proposed code change. Give Engineer the change, what it should achieve and the project
        instructions. Ask it to inspect the code and run relevant checks where possible. Writer can summarize the
        findings; the people responsible for the code decide whether to accept the change.
      </p>

      <h2>9. Write release notes</h2>

      <p>
        Engineer or Researcher identifies the changes included in the release. Writer explains what they mean for users.
        Reviewer checks that the notes describe what actually shipped and that any setup instructions are accurate. You
        approve the notes before publication.
      </p>

      <h2>10. Draft a weekly project update</h2>

      <p>
        Researcher gathers changes from the project notes or issues you specify. Writer summarizes what is finished,
        what is stuck and what happens next. Reviewer compares the draft with the sources, and the project owners
        confirm the status.
      </p>

      <h2>11. Check a CSV export</h2>

      <p>
        Give Researcher a CSV file, such as an exported contact list, and explain what to check. It can look for
        repeated contacts, missing fields and inconsistent formatting. Reviewer checks the findings and totals. Keep the
        original when you request a cleaned copy.
      </p>

      <h2>12. Draft a support reply</h2>

      <p>
        Give the team the customer’s question and relevant help pages. Researcher finds the guidance, Writer drafts the
        reply, and Reviewer flags account details that need checking. A support person reviews and sends the response.
      </p>

      <h2>Join related jobs into one process</h2>

      <p>
        A product update can start with the documentation check in workflow 1. Ask the team to use those research notes
        to update an article in workflow 5. Once you approve the updated article, Writer can use it for social drafts in
        workflow 6. The same agents and source notes support all three jobs.
      </p>

      <p>
        For a software fix, Engineer can investigate an issue in workflow 7 and review the resulting pull request in
        workflow 8. When the fix ships, the team can use workflow 9 to prepare release notes, then update the FAQ or
        draft support replies using workflows 3 and 12.
      </p>

      <p>
        Tell the Coordinator which jobs should follow each other and when you want to review the result. For example:
        check the facts, update the guide, wait for your approval, then draft the posts.
      </p>

      <h2>Run the process again</h2>

      <p>
        Start with one real task in the channel. Check that each agent can open the sources and files it needs, and that
        the Coordinator gives you a clear final draft to review.
      </p>

      <p>
        Once you are happy with the process, you can set it up on OpenBot's Workflows page. Choose which agent handles
        each step, pass its result to the next step, and add an <strong>Approval</strong> step wherever you want the
        process to wait for your decision. A workflow can run on a schedule. For a single task repeated by one agent,
        use a scheduled routine.
      </p>

      <p>
        Try the full process with your own files and accounts before scheduling it. The computer or server running
        OpenBot needs to be available when the work runs.
      </p>

      <p>
        Read more about{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-agent-workflow" }}>
          a single task from brief to finished result
        </Link>{" "}
        and{" "}
        <Link to="/guides/$slug" params={{ slug: "ai-teammates-vs-ai-chatbots" }}>
          when to split work between agents
        </Link>
        .
      </p>
    </>
  );
}
