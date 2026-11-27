### Fixed

- A hosted or self-hosted server keeps answering when agents run heavy jobs, such as builds, dev servers and browser tests. These jobs now get a smaller share of the CPU, the disk and the memory than OpenBot, so they run slower when the server is full, and they no longer stop the server for many minutes. The server must be on the new version. (#17134)
