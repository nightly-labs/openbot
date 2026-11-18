// Frozen optional agent-welcome-v1 contract.
//
// What it grants, recorded here because freezing it makes it permanent: a client that sends it says
// that the `initialMessage` of each agent it creates with `POST /v1/agents` is a setup message for the
// new agent, not a message from a person. A host that sends it keeps that first message out of the
// chat, its history pages, the search, the queue and the preview, for every member. The agent answers
// it as its first turn, and that answer shows as usual. Both sides need it: a client sends a setup
// message only to a host that sends it, and a host hides the first message only for a client that
// sends it. Without it on either side, the first message stays a visible user message, as before.
// The request and the response keep the frozen shape. A protocol 9 capability only. Widening any of
// it needs a second capability string.

export const AGENT_WELCOME_CAPABILITY = "agent-welcome-v1";
