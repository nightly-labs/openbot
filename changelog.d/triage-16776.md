### Fixed

- The models of a custom provider that you save now show in the agent model menu also when OpenCode does not start again on the first try. Before, OpenBot kept the old OpenCode process, which did not know the new provider, and the models came only after about 10 minutes with no use, or after a restart of OpenBot. Now OpenBot stops the old process and starts OpenCode again. If OpenCode still cannot start, Providers shows the start error. A process that runs a task is kept until the task stops, as before. On a joined server, the server must also be on this version.
