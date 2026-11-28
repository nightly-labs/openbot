### Fixed

- A page in the OpenBot browser that stopped answering again each time it loaded no longer keeps using CPU after the agent's reload or new address times out. Before, the page script kept running in the background until somebody closed the tab. Now OpenBot stops the page, and the agent can open a different page in the tab or close it.
