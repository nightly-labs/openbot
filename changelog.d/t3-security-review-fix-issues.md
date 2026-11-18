### Security

- On a joined server, a member with no access to an agent can no longer see or use that agent's browser tabs. Before, the member could watch or control those tabs, or open a new tab with that agent's sign-ins.
- A joined server can no longer use the remote screen viewer to send requests to another joined server with your session. Before, all joined servers shared one viewer secret.
- Logs and diagnostics now hide more secrets: tokens after any `Authorization` scheme (such as `Bot`), environment values given as name and value pairs, Google OAuth tokens, Telegram bot tokens, and Slack and Discord webhook addresses.
- The network guard now refuses more IPv6 addresses that point to a private IPv4 address.
- On Windows, a `where.exe` file in an agent's folder can no longer run when Pi starts.
