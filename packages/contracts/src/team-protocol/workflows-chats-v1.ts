// Frozen optional workflows-chats-v1 wire contract. Keep IPC types and limits out of this file.
//
// What it grants, recorded here because freezing it makes it permanent: it lets an owner or admin of a
// joined server add and change Telegram and Slack triggers and outputs through `workflows-v1`, whose
// routes and grants stay as they are. It adds no route. A host that advertises it runs a trigger node
// with `trigger: "telegram"` or `trigger: "slack"` and an output node with `target: "telegram"` or
// `target: "slack"`; their settings cross in the open node fields of `workflows-v1`. The `connectionId`
// of these nodes is the `connectionId` of a Telegram chat or a Slack workspace from the
// `routine-results-v1` options, and the `placeId` of a Slack node is the `id` of one of its places, so
// a client needs `routine-results-v1` too. These nodes speak in the host's Telegram chats and Slack
// workspaces, so only an owner or admin can add or change one; a member can run one that is there. A
// host without it can keep these nodes, and a client shows them read-only. Discord nodes are not in it:
// their role filter needs the host's Discord roles, which no route sends. Widening any of it needs a
// second capability string.

export const WORKFLOWS_CHATS_CAPABILITY = "workflows-chats-v1";
