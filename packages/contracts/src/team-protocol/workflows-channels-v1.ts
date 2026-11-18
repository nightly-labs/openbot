// Frozen optional workflows-channels-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: it lets an owner or admin of a
// joined server add and change workflow outputs into the host's OpenBot channels through
// `workflows-v1`, whose routes and grants stay as they are. It adds no route. A host that advertises
// it runs an output node with `target: "chat-channel"`; its `channelId` crosses in the open node
// fields of `workflows-v1` and is the `id` of a channel that the `channels-v1` list of that host gives.
// The result shows in the channel as a note of the workflow; no task starts. These outputs post in
// the host's channels, so only an owner or admin can add or change one; a member can run one that is
// there. A host without it can keep these nodes, and a client does not offer the target. Widening any
// of it needs a second capability string.

export const WORKFLOWS_CHANNELS_CAPABILITY = "workflows-channels-v1";
