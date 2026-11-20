### Fixed

- Downloads and updates of provider tools, such as Gemini and ChatGPT, now use the proxy settings of
  your computer, as the built-in browser does. Before, OpenBot ignored these settings. On a network
  that opens GitHub only through a proxy, the download failed with an error such as "connect EBADF",
  and Retry failed again, but your browser could get the same file.
