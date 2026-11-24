### Fixed

- In the web client, a large attachment on a very slow connection no longer stops after one minute while it still uploads. Before, a file of more than 4 MB stopped when the connection sent less than about 50 KB each second. Now the upload continues while data moves, and it stops only when no data moves for one minute.
