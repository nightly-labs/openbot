# `apps/auth-api`

The Cloudflare Worker behind accounts, avatars, host configuration, memberships, invitations and
logical sessions. It never holds chats, files or commands, and the app works without it — a change
here must not become something core function depends on.

## Mobile development over LAN

`dev-network-access.ts` restricts which routes a phone can reach through the Vite dev server.
When wiring mobile account features, check this allowlist as well as the API handler. Profile,
avatar reads/writes and account-session list/revocation must be reachable; their handlers still
enforce authentication. Keep desktop-only sign-in/ticket routes blocked and extend
`test/dev-network-access.test.ts` with both allowed paths and nearby paths that must stay denied.

## D1 migrations run before the Worker that needs them

`migrations/` is a second, unrelated database to the user's SQLite in `src/backend`. CI applies
these migrations **before** deploying the new Worker, so for the length of that gap the old Worker
is running against the new schema. Every migration must be backward compatible with it: adding a
`NOT NULL` column without a default, renaming one, or dropping one the deployed Worker still reads
takes production down between the two steps.

One that cannot be backward compatible needs a test proving the old Worker tolerates the new schema,
or a two-step release — expand the schema, deploy the Worker that uses it, then contract in a later
change.

This is a different rule from the one in `src/backend/AGENTS.md`. There, migrations are irreversible
because they run on the user's own machine with no backup; here they are reversible but *raced*.

## Worker runtime callbacks

Wrap global `fetch` when storing it in a service or dependency object:
`(input, init) => fetch(input, init)`. Passing the bare function and later calling
`dependencies.fetch(...)` changes its receiver and throws `Illegal invocation` in workerd,
even when Node tests pass. The remote account-event outbox covers this receiver constraint;
keep profile and session notifications on the signed Signal path without polling.

Profile writes await only the durable outbox insert. Schedule Signal delivery with Worker
`waitUntil`, and bound each webhook request with a timeout so a slow Signal cannot turn a
successful profile save into a client timeout. Failed delivery stays in the existing retry outbox.
