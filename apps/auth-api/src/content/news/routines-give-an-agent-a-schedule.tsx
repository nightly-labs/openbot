export function RoutinesGiveAnAgentASchedule() {
  return (
    <>
      <p>
        Most of what you ask an agent twice, you will ask it a hundred times. Read the overnight build log. Summarise
        what changed in the repository since yesterday. Check whether the thing you fixed on Friday is still fixed. None
        of it is hard; all of it depends on you remembering to ask.
      </p>

      <h2>A routine is one instruction on a clock</h2>
      <p>
        A routine belongs to one agent. It holds the instruction and the times to run it, and nothing else. When it
        fires, the agent does the work in its own workspace and its own thread, exactly as if you had typed the
        instruction yourself.
      </p>
      <p>
        That last part matters more than it sounds. The result lands in the thread you already read, next to the context
        that explains it. There is no second inbox to check.
      </p>

      <h2>Keep them small</h2>
      <p>
        A routine that says "review the repository" produces a wall of text you will stop reading by Wednesday. A
        routine that says "list the tests that started failing since the last run, and nothing else" produces something
        you act on.
      </p>
      <p>
        The test we use is simple: if the usual answer is "nothing to report", the routine is probably the right size.
      </p>

      <h2>They are not a scheduler</h2>
      <p>
        A routine is an instruction for an agent, not a job runner for your machine. It has no retry policy and no
        dependency graph, and it is the wrong tool for anything that must happen exactly once at exactly one time. Use
        it for the reading and the noticing, and keep the deploy on the deploy system.
      </p>
    </>
  );
}
