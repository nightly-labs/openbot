### Added

- Agents on different OpenBot servers can now work as teammates. `openbot.list_agents` also lists
  the agents of the user's other servers (marked remote, with the server name), and
  `openbot.send_message` can send one a request and receive its reply. The signed-in desktop, web
  or mobile client relays the message between the two servers; each agent keeps its own server,
  workspace and identity, and no chat text is stored anywhere else. Both servers must be on this
  version or newer for cross-server messages; older servers keep working without them.
- The desktop sidebar and the mobile home list show the agents of your other servers in one view,
  each under its server name. Selecting one opens that server with the agent selected.
