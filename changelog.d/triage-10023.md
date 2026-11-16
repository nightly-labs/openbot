### Fixed

- A Hermes agent now answers when more MCP servers are turned on than Hermes accepts. Before, each
  message failed with "Internal error: invalid_params". Hermes now gets the MCP servers that fit,
  and a message names each server that it did not get, so you can turn off the servers that you do
  not need.
