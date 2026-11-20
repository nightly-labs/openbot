### Fixed

- In the agent's own chat, the steps row of a finished answer stood in the message actions and
  opened only the trace, so the reasoning that a provider sent stayed unreadable there. A side
  thread could open its steps list the whole time. The agent chat now shows the steps row above
  the answer, as a side thread does, so the trace pick and the "Show agent steps" setting open the
  reasoning list there too. Channel answers keep their one-line steps row that opens only the trace.
