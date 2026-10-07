### Fixed

- A host that clients reconnect to many times no longer runs out of network sockets and becomes unreachable until a restart. After 10 ICE restarts, a remote connection is replaced with a new one.
