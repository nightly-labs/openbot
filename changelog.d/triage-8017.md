### Fixed

- An agent can fill a saved login again after it ran a script on a site that uses a service worker.
  Before, the fill was refused after each reload until OpenBot restarted. Now one reload by the agent
  is enough, and the agent is told which reload to use. For a browser on a joined server, the server
  must also be on the new version.
