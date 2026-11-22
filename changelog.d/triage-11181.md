### Fixed

- Agents can now see who answered a card. Before, a click in the desktop app on the computer that
  runs OpenBot did not save who answered, and agents could not read the name from any card, so an
  agent asked again in chat for an approval that you already gave. On a joined server, the server
  must also be on this version.

### Security

- A local script can no longer press a card button that only the owner or an admin can press, such
  as a confirm or danger button. An agent can run a local script, so before, it could approve its
  own card as if you had pressed the button.
