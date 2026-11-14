### Fixed

- Voice model downloads, for replies read aloud and for dictation, now use the proxy settings of your
  computer, as the built-in browser does. Before, OpenBot ignored these settings. On a network that
  opens huggingface.co only through a proxy, the download showed "Could not download the voice
  model. Try again." each time, but your browser could get the same files.
