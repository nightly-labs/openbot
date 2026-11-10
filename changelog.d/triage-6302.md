### Fixed

- When you revoke the OpenBot GitHub App on GitHub, GitHub in OpenBot now shows "The GitHub connection expired" and a Reconnect button. OpenBot finds the revoke when an agent's GitHub tool fails, when the GitHub page in Marketplace reads your repositories, or at the regular GitHub token check. Before, GitHub showed "Connected" for up to 8 hours, and every GitHub tool failed.
