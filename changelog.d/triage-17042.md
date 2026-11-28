### Fixed

- On an ARM64 Linux computer or server, such as a Raspberry Pi, the agent browser no longer gives sites values that disagree. Its user agent now says `X11; Linux x86_64`, as Chrome does on all Linux computers. On a server with no GPU, it names an ARM GPU, not an Intel GPU. A server must be on this version to get the fix.
