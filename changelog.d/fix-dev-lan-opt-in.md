### Fixed

- `bun run dev` now binds the local Auth API and Signal service to `127.0.0.1`. Pass `--lan` to
  reach them from a phone on the local network. A LAN start refuses to run while the Auth API
  returns development sign-in codes, because anyone on the network could then sign in.
