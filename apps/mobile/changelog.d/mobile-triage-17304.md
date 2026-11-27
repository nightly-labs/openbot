### Fixed

- When the connection to the server stops for a short time, a workflow approval, retry or stop that you tap now waits up to 15 seconds for the connection and is then sent. Before, it failed at once with "The selected server is offline.", and the approval stayed pending. While the server is offline, these buttons are now disabled.
