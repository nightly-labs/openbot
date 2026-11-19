### Fixed

- When a provider waits to update or restart until its running tasks end, the message queue of each agent on that provider now says so. Before, the queued messages waited with no reason, and the agents looked frozen. This also shows on a joined server and in the web client when the server has this version.
