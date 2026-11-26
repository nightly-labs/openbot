### Fixed

- A channel task of an agent that runs one turn at a time now starts after the current turn of that agent. Before, when the agent got new messages in its own chat all the time, for example from teammates, each new message started first and the channel task could wait for a long time. Now the channel task starts before the messages that came after it. Messages that came before it still go first. On a joined server, the server must also be on this version.
