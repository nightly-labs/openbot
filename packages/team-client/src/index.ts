export type TeamClientFetch = typeof globalThis.fetch;

// Deliberately not `export * from "@openbot/contracts/team-protocol"`. That barrel pulls every
// frozen per-version codec and adapter - v1 through v3 plus the WebRTC adapter - into any consumer
// that touches the root export, which on React Native and in a browser is bundle weight for
// protocol versions the client will never negotiate. A consumer that needs a protocol symbol
// imports the contracts subpath that has it; this package re-exports only its own.
//
// Each module below also has its own subpath in `package.json`, so a consumer can narrow further.
export * from "./remote-directory";
export * from "./remote-recovery";
export * from "./request-id";
export * from "./webrtc-framing";
export * from "./workspace-preferences";
