# Message routing

Thread is an optional host mode for incoming work. Queue and Steer keep their released behavior.
A host with no message routing preference follows its saved Queue or Steer settings. An upgrade
does not select Thread or change the host's turn limits.

## Select a mode

On the computer that runs the agents, open Server Settings > Agents > Messages while working.
Choose Queue, Steer or Thread for the host, or choose a mode for one agent. An agent's explicit
Queue or Steer setting still applies after a host default change. Select the default for that agent
to make it follow the host. The same choice is in the local agent settings.

- Queue leaves the message for its conversation's next turn.
- Steer sends the message into the current turn when the provider supports it. This includes
  teammate requests. Other messages stay in the queue.
- Thread asks Jev to choose main, an open related chat, or a new work chat. An independent job can
  then run beside the main chat. Messages in one chat still run in order.

Thread also handles a message sent while main is idle. Explicit task and reply targets bypass the
classifier. A reply to the main notice resolves to its actual work chat. Agent setup, welcome
messages, routines, late question answers, approvals and external messaging keep their existing
context. Teammate multicast requests keep their existing batch behavior.

## Configure Jev

Set `EXPERIENTIAL_API_KEY` in the host environment or in OpenBot Vault as an API key visible to the
recipient agent. The Vault value takes precedence. Do not put a key in a message or routing file.
Queue and Steer need no key.

The host sends one request to `https://api.experientiallabs.ai/v1/systemone`, using `jev-latest`.
This is an additional provider request and can incur provider charges. It contains the incoming
message, permitted work titles, and, for an own-agent user request, a bounded main-chat subject.
OpenBot masks known secrets before sending. It sends no attachment bodies, task IDs, agent IDs or
work transcripts. The provider receives temporary choice labels. It returns a choice and
confidence; the host alone maps the label to a permitted local chat.

Jev has five seconds to answer. The planner has an outer ten-second deadline. There are no retries
or alternate providers. A confidence below 0.8 selects main. A missing key, failed request, invalid
answer, stale chat or changed access leaves the request in main. The threshold is an OpenBot
routing rule, not a guarantee of model accuracy. A failed task admission reports an error without
silently duplicating the request. Attachment or database failure keeps an unconsumed draft and
removes a newly created empty chat, so the original send can be retried.

## Scope and concurrency

The owner can route to their agent's open, non-routine work chats. A teammate can find only managed
work in its own caller scope, or a shared sidebar section scope. Moving an agent between sections
changes that scope. The host checks ownership, visibility, open state and creation generation
after classification and immediately before commit. Provider output does not grant access.

The host classifies independent requests concurrently. It holds a per-agent admission lock only
for local admission, chat creation and enqueue. Simultaneous new requests can choose separate chats
before either chat exists. There is no promise that these requests will be merged.

Thread uses the released agent task limit and host turn limit. It adds no saved limit override.
Providers that support one turn at a time still have that restriction. The released bound of 50
open task chats still applies. Resource, provider and approval holds still apply. Side chats share
the agent's workspace files; concurrent file edits need normal coordination.

## Follow-ups and queued work

The agent tools `dispatch_work` and `find_work` provide explicit routing with a stable work key or
task ID. A retry returns the original receipt. Replies return to the sender's original task when
the sender used one. Archived work needs an explicit reopen. A deleted task ID is unavailable; a
later keyed request can create fresh work without restoring the deleted transcript.

`list_queued_work` reads at most 100 requests, including their full text, from the calling agent's
own main queue. `dispatch_queued_work` moves one selected original delivery to a work chat, or groups
it in a selected managed chat. It preserves the sender, files, delivery ID and reply route. It does
not replay or copy the request. The caller must select only independent, self-contained work.
Approvals and context-dependent follow-ups must stay in their original context. Metadata checks
reject replies, routines, setup messages, external messages, continuations and multicast requests.
Thread never splits an old queue in bulk.

## Notices, storage and compatibility

An automatically routed user request shows a short notice in main and its actual text in the work
chat. The notice has the delivery ID of the real request, so existing clients can settle a pending
send. It is an inert view of host mailbox metadata, with no delivery, exchange or attachments.
Neither raw conversation rows nor replayable conversation events contain a duplicate request or
notice. A notice cannot be sent to a provider, reacted to as an answer, or used as an unread cursor.
Deleting it, or clearing main history, leaves the child work in place.

The separate `custom-message-routing-v1.json` preference file never enters an agent export or a
released Team API busy-message field. The local host configuration uses additive IPC methods.
Remote desktop, web and mobile configuration screens deliberately stay unchanged in this draft.
Their existing Queue/Steer editors still replace the relevant Thread preference when used.
Routing runs on the host for existing task-capable clients, which use their released task screens.
A peer without task screens keeps its request in main. The host must have this feature for Thread
to run. This local configuration exception does not add a Team API capability or change a shipped
protocol's meaning.

`custom-thread-routing-status-v1.json` retains at most 200 diagnostic entries. Each entry contains
the agent ID, outcome, reason code, timing, candidate count, optional HTTP status and timestamp.
It contains no message, title, response body, credential or task ID. Recording does not wait for
disk. The host owns the writer and flushes it during shutdown.

## Validation

Focused fixtures use temporary profiles, real SQLite, injected routing decisions and a fake local
provider process. The Jev adapter fixture uses loopback HTTP and a synthetic key. No fixture calls
the paid provider. The service fixture covers active main work, parallel classification, related
work, retries across mode changes, source replies, setup turns, teammate Steer, failed commits and
notice isolation. Separate fixtures cover backlog moves, scope checks, released task snapshots,
receipt rollback safety and the local settings store. These checks do not prove real Jev accuracy,
provider throughput or safe concurrent edits to one workspace file.
