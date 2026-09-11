export function EveryAgentGetsAWorkspace() {
  return (
    <>
      <p>
        Every agent keeps a directory of its own on disk. It is where the agent puts its own files, and where they stay
        between runs. When you want to know what an agent has been working on, that directory is the first place to
        look.
      </p>

      <h2>One directory per agent</h2>
      <p>
        The workspace outlives the conversation. Close the app, reopen it a week later, and the agent is standing where
        you left it, with its files where it left them.
      </p>

      <h2>A shared directory for handoffs</h2>
      <p>
        Next to the agents' own directories there is one shared directory that every agent can use. An agent keeps its
        own work in its workspace and puts files that another agent needs in the shared one. A file there is there
        because an agent put it there for someone else, so a handoff stays something you can see.
      </p>

      <h2>What a workspace is not</h2>
      <p>
        A workspace organizes work. It does not limit what an agent can touch. Agents run with full access to your
        files, your programs and the network, so an agent can read or change a file outside its directory, including one
        in another agent's workspace.
      </p>
      <p>
        Say in an agent's instructions where its work belongs, and keep backups or version control for anything you
        cannot afford to lose.
      </p>
    </>
  );
}
