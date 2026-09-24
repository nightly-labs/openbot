# `packages/team-client`

`@openbot/team-client` holds the Team connection code that desktop, mobile, and the public web
client share: the remote directory, the authenticated WebRTC peer, recovery, file transfer, and
WebRTC framing.

- Do not change the meaning of a shipped wire format. `webrtc-framing.ts` encodes the frames of
  Team protocol v2, and hosts and clients of older releases still use it. Put a new behaviour behind
  a new protocol version or capability in `packages/contracts/src/team-protocol`. See
  [contract rules](../contracts/AGENTS.md).
- Keep the code independent of Electron, Node, and the DOM beyond WebRTC and `fetch`. Mobile runs it
  in React Native. Pass platform objects in as arguments, as `TeamClientFetch` does.
- Do not re-export `@openbot/contracts/team-protocol` from `index.ts`. The comment there says why.
  Each module has its own subpath in `package.json`.
- Do not log tokens, tickets, or message bodies.

Run one test file: `bun run test:desktop -- packages/team-client/src/<name>.test.ts`.
