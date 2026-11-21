### Fixed

- When the processor of a computer cannot run Claude, such as a virtual machine without SSE4.2, OpenBot now says
  that the processor cannot run this provider and that you must use a different provider. Before, the row said
  "Download failed. Try again.", and each new try downloaded the provider again and failed in the same way. On a
  joined server, the server must also be on the new version.
