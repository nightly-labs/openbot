### Fixed

- When one agent sends another a correction while that agent still works on its request, the
  correction joins the running work and the answer carries it. Before, the correction started a
  second request and came back as a separate answer, or waited without ever answering when the
  recipient could not take it into the running turn.
