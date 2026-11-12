### Fixed

- A Gemini turn that showed a warning line, such as "⚠ One check was slow", and then continued with
  more work now completes with its answer in the chat. Before, the turn showed as failed, and the
  red error showed the agent's final answer as its text. Routines that did this were also marked
  as failed.
