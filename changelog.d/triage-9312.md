### Fixed

- Hermes agents, also a custom agent that runs `hermes acp`, can use all OpenBot tools, such as
  sending a channel result. Before, Hermes hid the OpenBot tools behind its own tool search and
  refused their names, so a channel member could not finish its work. Each OpenBot tool is now a
  Hermes tool that its tool search finds. Keep Hermes's tool search on, which is the default: if you
  turned it off (`tools.tool_search.enabled: off`), Hermes gives the model every OpenBot tool in each
  request.
