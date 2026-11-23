### Fixed

- An agent that gets the answer of another agent through a routine link can now end its step with
  nothing to report and stay silent, as the routine's own agent can. Before, it had to write a
  message, so each linked step of a scheduled routine put an extra message and a notification in its
  chat. The agents after a silent step are skipped. In a Test run, a linked agent still shows its
  answer.
