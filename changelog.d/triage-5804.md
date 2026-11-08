### Fixed

- When an agent sent a teammate several requests and they joined one running turn, only the request that the teammate answered got a result. The other requests now get the result of that turn too, so the agent that asked does not wait forever.
