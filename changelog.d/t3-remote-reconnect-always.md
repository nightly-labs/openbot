### Fixed

- The web app connects again by itself when a server comes back after an update or a long restart. Before, the page could wait up to two minutes before it tried again, and you had to reload it. Now Signal holds the page's connection while the server is offline and connects it as soon as the server is back. This needs the updated Signal service; with an older one, the page tries again as before.
- A device that was connected when its server restarted no longer stays at "Loading" until you reload. Signal now tells the device to connect again when the restarted server cannot continue the old connection.
- A server whose Signal connection closed for good no longer shows as online while no device can reach it. The server now reports an error, and a cloud server publishes itself again.
