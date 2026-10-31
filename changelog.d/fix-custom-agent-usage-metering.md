### Fixed

- Custom agents keep the cost they report and their token counts in usage. Before, the usage of a
  custom agent showed no cost and lost its input and cache counts, so the usage page and the
  analytics undercounted what the agent spent. Now every agent whose CLI reports a session cost
  keeps that cost, and an agent that reports session totals, as the ACP contract documents them,
  keeps its full token counts. An agent that reports each turn's token counts instead of session
  totals still meters only its first turn, so agent authors must send session totals.
