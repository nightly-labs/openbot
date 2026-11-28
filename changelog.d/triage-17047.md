### Fixed

- A slow page that an agent opens in the OpenBot browser now finishes loading. Before, when the page took longer than the agent's wait, OpenBot stopped it and the agent reported "Navigation timed out.". A page that was already open, such as a cloud console, then showed only its header and not its data. A page that does not start to load in time still fails as before. A joined server must be on this version to get the fix.
