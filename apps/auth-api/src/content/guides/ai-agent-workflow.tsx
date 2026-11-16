import { Link } from "@tanstack/solid-router";

export function AIAgentWorkflow() {
  return (
    <>
      <p>
        An{" "}
        <Link to="/guides/$slug" params={{ slug: "what-are-ai-agents" }}>
          AI agent
        </Link>{" "}
        workflow is the sequence that takes a request to a result you can use. For a first workflow in OpenBot, pick one
        task and define what you want to receive. A short, sourced release brief is a good example.
      </p>

      <p>
        Suppose a tool your team uses just released an update. You want to know what changed, who needs to know and what
        still needs checking before you share the news internally.
      </p>

      <h2>1. Give the agent a clear brief</h2>

      <p>
        Name the tool and the release. Say who the brief is for, what to cover and where to save it. If you have the
        official release page or last week’s brief, give the agent those links or files.
      </p>

      <p>Here is a prompt you can adapt:</p>

      <blockquote>
        <p>
          Read the official release notes for [tool and version]. Pick up to three changes that matter to our support
          team. For each one, explain who it affects and link to the source. Flag anything you cannot confirm. Save the
          draft as release-brief.md in your workspace and show me the file for review.
        </p>
      </blockquote>

      <p>
        You now have a way to check the result. The file should exist, the changes should be relevant to support, and
        the links should back up what the brief says.
      </p>

      <h2>2. Check what the agent found</h2>

      <p>
        Start with the release notes. For details such as plan availability or setup steps, ask the agent to check the
        relevant official help page too. If the sources disagree or a detail is missing, keep that item open for review.
      </p>

      <p>
        If the agent cannot reach a page, give it the official text or another source it can access. A missing source is
        a reason to flag the claim for review.
      </p>

      <h2>3. Review the file</h2>

      <p>
        Open the brief and check its most important claim against the source. Make sure the version is right and the
        summary says who is affected. If it mentions a new feature, check whether the source says the feature is
        available to everyone or limited to a particular plan.
      </p>

      <p>
        A reply in chat is useful for seeing what the agent did. Open the actual file to verify that the brief was saved
        and is ready to share. If the task is still queued, check again once the agent has finished.
      </p>

      <h2>4. Keep what you will need next time</h2>

      <p>
        Save the reviewed brief with the release version or date. For the next update, you can ask the same OpenBot
        agent to read it for the format and check the new release notes for the facts.
      </p>

      <p>A previous brief is a useful template. Check its claims again before reusing them in a new version.</p>

      <h2>When to move the task into OpenBot Workflows</h2>

      <p>
        Start by running the task from chat. Once the steps are clear and you need to repeat them, you can build a
        workflow on OpenBot’s Workflows page. A workflow can include agent steps and an approval step that waits for
        you.
      </p>

      <p>
        For example, set the agent step to prepare the brief, then connect it to an Approval step. Open the saved brief
        before you choose Approve or Reject. Connect the step that shares the result after Approval so it runs only
        after you approve. Run the workflow once and check that you can find the brief and review it before anything is
        shared.
      </p>

      <p>For a single release brief, a clear prompt, a saved file and your review are enough.</p>
    </>
  );
}
