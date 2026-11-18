### Fixed

- When a ChatGPT agent sends its model requests to your own address (`OPENAI_BASE_URL` under
  Variables in the ChatGPT settings) and the connection stops while the agent compacts its context,
  the error now also tells you to check that address. Before, it told you only to check your
  internet connection, also when the address was wrong (for example, without `/v1` at the end), so
  each new message failed again. For an agent on a joined server, the server must also be on the
  new version.
