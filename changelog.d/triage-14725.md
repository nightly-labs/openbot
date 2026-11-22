### Fixed

- An agent's messages no longer stay queued for good when its session settings do not load or save. Before, the agent sent no more messages until OpenBot restarted. Now, after 5 minutes, the settings panel shows an error and the queued messages send.
