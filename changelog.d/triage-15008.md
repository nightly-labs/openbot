### Fixed

- When the channel lead's model fails while it routes a message, the channel now says why: the model is busy, it lost its connection, the sign-in expired, the model is not available, or the model refused the request. Each message also says what to do next. Other failures still show the general message. On a joined server, the server must also have this version.
