### Fixed

- An agent no longer writes the same "still pending" message again and again after a teammate sends back a partial result. Before, the automatic check continued the agent up to 3 times, each continuation repeated the status, and then the chat said that the agent stopped before the request was done. Now, when an automatic continuation does no work with tools, the request ends quietly. On a joined server, the server must also be on this version.
