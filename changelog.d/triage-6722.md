### Fixed

- When a Kimi model step fails and Kimi ends the turn with no answer, the chat now says that Kimi ended the turn with no answer, and tells you to send the message again. An agent set to switch to its backup models now uses them. Before, the agent went back to ready, and the chat showed no reply and no error (#6722). On a joined server, the server must also be on this version.
