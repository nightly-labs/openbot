### Fixed

- In the Routines view, the webhook of a routine now has the "Use the sender's secret" button, as it
  has in the agent's settings. You can paste a signing secret that the sender made, such as a
  Composio or Svix secret. Before, the Routines view showed only "Regenerate signing secret", so
  senders that make their own secret could not start the routine. On a joined server, the button
  shows when the server has OpenBot 0.61.0 or newer.
