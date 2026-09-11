export function ScheduleARoutine() {
  return (
    <>
      <p>
        A routine is one instruction and the times to run it. It belongs to one agent, and when it fires the agent does
        the work in its own workspace and its own thread — exactly as if you had typed the instruction yourself.
      </p>

      <h2>Write the instruction first</h2>
      <p>
        Write it as a question you would actually ask, then read it back and ask what the answer will look like on a
        quiet day. If it would be a wall of text, the instruction is too broad to schedule.
      </p>

      <h2>Pick the times</h2>
      <p>
        Choose the times from when you will read the result, not from when the work could be done. A summary that lands
        at three in the morning and is read at nine is a summary that was written too early.
      </p>

      <h2>Keep it small</h2>
      <p>
        The test we use: if the usual answer is "nothing to report", the routine is probably the right size. A routine
        is an instruction for an agent, not a job runner — it has no retry policy and no dependency graph, so keep the
        deploy on the deploy system.
      </p>
    </>
  );
}
