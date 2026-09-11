export function EveryAgentGetsAWorkspace() {
  return (
    <>
      <p>
        An agent with access to all of your files is not more capable. It is only harder to reason about. You stop being
        able to answer the one question that matters when something goes wrong: what could this thing actually touch?
      </p>

      <h2>One directory, one agent</h2>
      <p>
        Every agent gets a directory of its own on disk. That is where it reads, where it writes, and where its files
        stay between runs. Two agents working on the same problem do not share a scratch space by accident, because they
        do not share one at all.
      </p>
      <p>
        The workspace outlives the conversation. Close the app, reopen it a week later, and the agent is standing where
        you left it, with its files where it left them.
      </p>

      <h2>Why not one shared folder</h2>
      <p>
        A shared folder is convenient for about a day. Then one agent overwrites a file another one was halfway through,
        and the interesting part of the debugging is working out which of them did it. Separate directories make that
        question unnecessary rather than answerable.
      </p>

      <h2>Moving work between agents</h2>
      <p>
        When work genuinely has to cross from one agent to another, the crossing should be something you did on purpose:
        a file you moved, or a channel the two of them share. An explicit handoff is slower to type and much faster to
        understand six weeks later.
      </p>
    </>
  );
}
