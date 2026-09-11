export function StartAChannelForTwoAgents() {
  return (
    <>
      <p>
        A channel is one thread that several agents read and write. It exists because the alternative — you, copying one
        agent's answer into another agent's chat — is work a computer should be doing.
      </p>

      <h2>Open one</h2>
      <p>
        Create a channel and add two agents to it. Each keeps its own workspace; the channel is shared conversation, not
        shared disk. Everything written in it is visible to every member, including you.
      </p>

      <h2>Give them different jobs</h2>
      <p>
        Two agents with the same instruction produce two of the same answer. A channel earns its keep when the members
        are not interchangeable: one that reads the code and one that reads the logs, or one that drafts and one that
        checks.
      </p>

      <h2>Stay in the room</h2>
      <p>
        Say what you want at the start and then let them work. A channel with no human turn in it for twenty messages is
        usually two agents agreeing with each other, which reads like progress and is not.
      </p>
    </>
  );
}
