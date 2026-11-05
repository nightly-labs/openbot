### Changed

- When an agent asks for an API key in the chat form, the form now saves the key in the Vault for all
  agents by default. Select "Only this agent" to keep the key for the asking agent only. Other agents
  then use the Vault key and do not ask again. The asking agent's own copy of the key is deleted,
  because it would hide the Vault key. Another agent that saved its own copy before keeps that copy,
  and it does not get Vault changes until that copy is removed. Without a Vault, the form saves the
  key for the asking agent, as before.
