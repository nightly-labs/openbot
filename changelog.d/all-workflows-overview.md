### Added

- "All workflows", a page for every workflow of a server: what runs now and at which step, when each
  scheduled workflow runs next, how the last run ended, and Run and Stop on each card. A card's name
  opens that workflow on the canvas, and the page joins the rail next to Workflows.
- Issue numbers at the top of that page, from the optional `scripts/issue-stats.cjs` helper: the open
  issues per label, the ones that wait on a person, and what closed per priority over the last week.
  The helper reads `gh`, serves loopback only, and follows the project the page settings name.
- Plan rings for providers OpenBot does not read itself, from the optional local usage feed
  `scripts/usage-feed.cjs` (`ws://127.0.0.1:47831`): it discovers every z.ai coding-plan account in
  the OpenCode auth file and reads MiniMax when `MINIMAX_API_KEY` is set, one JSON message per
  reading.
- Settings of the page, behind one icon in its header: the GitHub project the issue numbers follow,
  colour rules with `*` wildcards that set each card's strip from the workflow name or the name of
  the agent that runs now, and which plan rings show.
