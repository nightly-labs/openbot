### Fixed

- Moving agents or sending a large file to a joined server on a slow connection now finishes. Before, when one part of the file did not send, the retry could fail with "The WebRTC file offset is invalid." and the transfer stopped. The server must also run this version.
