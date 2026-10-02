### Fixed

- When a custom ACP agent is slow to list its models, OpenBot now closes the session that it opened
  to read the list. Before, each slow model list kept one idle agent process open until OpenBot quit.
- When OpenBot stops an ACP agent (because it is idle, to restart it, or at quit), the errors that
  the agent writes while it stops go to the log. Before, OpenBot showed each of them as a "Provider
  error" message. When an agent stops on its own, OpenBot still shows its errors.
