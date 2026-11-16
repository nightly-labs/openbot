### Fixed

- An agent can now sign in with a saved Vault login on a page that asks for the password and the
  authenticator code together. OpenBot fills the saved password and the current code, then submits
  once. Before, the password field became empty when the agent filled the code, and you had to type
  a password that was already saved. On a joined server, the server must also be on this version.
