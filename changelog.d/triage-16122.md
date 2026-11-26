### Fixed

- A Docker server that stops responding now starts again by itself after 10 minutes. Before, the container stayed running with no response, for example after a crash when memory was low, until someone restarted it. Pull the new image to get this fix.
