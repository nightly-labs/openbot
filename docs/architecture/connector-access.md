# Connector access

This first version protects a whole agent. It does not give different people private accounts in
one shared agent. Roles grant **Use** for a protected MCP connector. A member must have Use for
every protected connector bound to an agent before the server permits any view, chat or management
of that agent. Owners and administrators keep access. Role membership is read from the existing
role store; connector policy does not copy member identities or accept an actor from a model.

In Server settings → Roles, protect a connector, assign the agents that can use it, and grant Use
on the Everyone or role page. A role adds to Everyone; it cannot remove an Everyone grant.
Management of connector configuration, commands, headers, tokens and sign-in stays owner/admin
only. Agent tools do not manage connections once any connector protection is configured, even
under Full access. The owner/admin settings path remains available.

## Compatibility and persistence

A connector with no policy row retains the released unrestricted behavior. Protecting a connector
creates a row with no assignments or grants by default. Protected connectors are excluded from
unknown agents and unassigned agents before provider command, environment, headers or tool
schemas are handed over. The host keeps `openbot-connector-access-v1.json`, with an optimistic
revision and serialized atomic writes. No database schema changes are needed.

The new optional `connector-access-v1` capability has owner/admin-only read and set routes. It is
advertised only to protocol 9 peers. Shipped `agent-access-v1` and `mcp-servers-v1` contracts remain
unchanged. The new route carries connector names and IDs and permission data; it carries no
configuration, environment values, headers or credentials. Older clients still get agent visibility
and request enforcement from the host; they cannot edit connector policy.

An agent keeps its history audience binding after removal from the connector's active assignments,
a disabled/deleted connector, or a role deletion. The first version does not remove protection or
copy/export protected agents. This prevents a normal assignment removal or copy from publishing
old private answers. Assigning protection is refused while the agent has an unfinished copy or
an active export; finish or cancel that operation first. New copy/export requests close before
policy persistence starts. Existing public copies, previously sent messages, downloads and other
information disclosed before protection cannot be withdrawn by a later permission change.

If policy cannot be read, member access and connector handoff close. An owner/admin can recover
with all access denied. The host binds every current agent to a protected recovery-history row,
protects every current connector, and grants or assigns nothing. This preserves confidentiality
when the original history bindings cannot be recovered. Owners then grant access explicitly.

## Runtime and revocation

Every provider reads its connector set using the host's agent ID, including Codex session
fingerprints, Claude, ACP adapters, Pi and Muse. An OAuth proxy route uses an agent-specific bearer;
the gateway checks current assignment on every request, including requests through old routes.

Saving connector policy immediately closes new handoffs while all current shared and confined
provider sessions stop. The save acknowledges success only after teardown completes. A failure
keeps new access closed and retains failed clients for another teardown attempt. Policy remains
persisted; it is not rolled back to permissive legacy state. A request already dispatched to an
external server may finish; revocation does not roll back an external email or event mutation.

Cross-agent native actions and direct messages require the same protected history audience. The
queue checks that boundary again before starting a delivery. It also rechecks host-stamped member
access for queued user work. Missing role membership does not grant a connector permission.

Native actions check the parsed, resolved agent ID at the operation boundary; free text is not
used as authorization evidence. This includes profile reads and changes, bulk updates, skills,
routines, waits and interrupts. Protected agents cannot create new agents or publish shared local
skill revisions or hosted sites: those artifacts would otherwise have a wider audience. Scoped
routine-flow disconnection is limited to links visible in the calling agent's own canvas.

Protected agents cannot join channels or external messaging conversations in this first version.
Their queued channel/external deliveries cannot start. Protecting an agent already in a channel
is refused. Native agent routines stay private to their agent, but forwarding results to an
external messaging destination is blocked, including saved pending outgoing results. Protected
agents do not run workflow steps or routine flow handoffs. Connector activation refuses agents
referenced by a current workflow or a stored workflow-run graph, so removing a node from the
current graph cannot expose a formerly private run through the workflow's shared output view.

## Threat model and verification limits

These controls protect supported OpenBot APIs, provider handoffs, proxy routes and shared agent
history. Coding agents intentionally have full host operating-system access. These permissions
are not a sandbox against a hostile agent reading host files, using shell tools or making its own
network requests. Do not describe them as an operating-system credential boundary.

Tests use temporary profiles, real SQLite/preference stores, the real Team API and local provider
and MCP fixtures. They do not connect a Google account, operate the installed application or
certify actual UI rendering. The Google plugin's mandatory human form approval and managed Google
OAuth onboarding remain separate connector concerns.
