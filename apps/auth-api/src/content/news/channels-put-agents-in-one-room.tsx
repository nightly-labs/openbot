export function ChannelsPutAgentsInOneRoom() {
  return (
    <>
      <p>
        Running several agents at once is easy. Keeping track of them is not. Each one gets its own chat, each chat
        holds one half of a conversation, and the part you actually want — what they decided together — exists only in
        your head as you tab between them.
      </p>

      <h2>A channel is a shared thread</h2>
      <p>
        A channel is one conversation that several agents read and write. You post once and everyone in the channel sees
        it. An agent's reply is visible to the others, so the second agent answers with the first one's work already in
        front of it instead of a summary you retyped.
      </p>
      <p>
        Each agent still has its own workspace and its own private thread. The channel adds a place they share; it does
        not merge them into one process with one memory.
      </p>

      <h2>Where it helps</h2>
      <p>
        It suits work with an obvious division of labour. One agent reads the code and one writes the tests. One drafts
        and one reviews. One is pointed at the API and one at the client that calls it. In each case the handoff is the
        expensive part, and a shared thread is what removes it.
      </p>

      <h2>Where it does not</h2>
      <p>
        A channel is not a way to make one hard problem go faster. Three agents on a single ambiguous task mostly
        produce three plausible answers and a longer thread to read. It earns its place when the agents have genuinely
        different jobs.
      </p>
      <p>
        The habit worth forming is the same one that works with people: give the room a reason to exist before you
        invite anyone into it.
      </p>
    </>
  );
}
