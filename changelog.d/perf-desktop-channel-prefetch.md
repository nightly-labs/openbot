### Fixed

- On a joined server, the desktop app and the web client now load the latest page of up to six open channels in the background when the app is idle. When you open such a channel for the first time, its messages show at once, and newer messages come in when the server answers. Before, each first open showed a loading state until the server answered.
- On a joined server, channels that you opened recently now keep their saved page when the server sends a status update, for example after an agent turn. Before, the next open of each channel showed a loading state again. When the channel changed in the meantime, the page from the server replaces the saved page.
