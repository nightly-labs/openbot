### Fixed

- On macOS and Linux, a provider check that did not finish in time, or that was still running when you quit OpenBot, stopped only the provider's start script. Programs that the script started, such as a version manager, continued to run and could make the computer slow. OpenBot now stops all of them.
