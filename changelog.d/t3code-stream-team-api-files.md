### Fixed

- A hosted server uses much less memory when a teammate or a remote device downloads or uploads a file. Before, one 100 MB file could use about 200 MB of memory for the full transfer. Now the server sends and receives files from disk. A server receives two attachment uploads at the same time. Other uploads wait for their turn; they do not fail.
