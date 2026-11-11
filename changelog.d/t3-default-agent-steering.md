### Changed

- A message that you send to an agent while it works now steers the running turn by default. Before,
  it waited in the queue until the turn ended. To get the queue back, turn off **Steer agents while
  they work** in Settings > Agents, or select **Queue** for one agent in its settings. If you already
  changed this setting, your selection stays. An agent whose provider cannot steer still queues the
  message. A joined server keeps its own default until it is on the new version.
- A request from another agent now waits for a turn of its own while the recipient works, also when
  the recipient steers. Before, a recipient with **Steer** selected took the request into its running
  turn, and the result for the other agent and the answer to you became one message. An answer or a
  notice from another agent still joins the running turn. Routine runs, channel work and messages
  from Slack, Telegram and WhatsApp start their own turn, as before.
- A steered message no longer makes an agent drop the work that it does. OpenBot now tells Codex, Pi,
  Muse and the models of an API key provider that the message adds to the current work: the agent
  answers a question first, applies a correction from that point, and then continues. Claude Code and
  Grok Build already did this.
