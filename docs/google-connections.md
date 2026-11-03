# Personal Google connections

Desktop members can open **Server settings → Google**, sign in with their own Google account, and
assign it to one existing teammate they can manage. Creation is outside this feature. Each account
has one active teammate; multiple accounts use separate profiles. The host owns the grant and runs
the reviewed `openbot-google-plugin` CLI. Members do not install a client or copy credentials.

An owner or admin enables enrollment once by selecting an installed private Google MCP connector.
This adopts that existing account and preserves its connector rule. The template must use an
absolute Node path, the installed package's `dist/cli.js`, a private profile directory, and exactly
one existing agent and role. The enrollment configuration and profile ownership are saved with the
host's existing secret cipher in `openbot-google-connections-v1.json`. CLI credentials remain in
owner-only files outside agent workspaces, as in the reviewed connector.

Google consent opens in the desktop user's system browser. The existing sign-in relay returns its
loopback callback over the authenticated host connection. If the callback port is busy, the user
can paste the final private callback address. The CLI retains its PKCE, state, five-minute deadline,
Google token refresh, and account validation. The requested permissions remain Gmail read/send and
Calendar list/events. Google writes retain the connector's mandatory human approval forms.

## Authorization boundary

- The authenticated member owns each profile. Request bodies cannot name an owner, role, OAuth
  client, command, path, or credentials. Profile and flow lookups give the same refusal for an
  unknown identity and another member's identity.
- `google-connections-v1` is an optional protocol 9 capability. Existing administrator sign-in relay
  routes are unchanged. Google routes accept only flows registered by the Google enrollment service,
  even if the member owns another type of flow.
- The configuration stays disabled until the connector rule, private role, and selected agent are
  durable. The host rechecks manage access, other connector audiences and profile exclusivity.
  Existing channel, workflow, pending-copy and export guards remain in the native connector policy.
- Members receive only a narrow personal-role grant. They cannot replace roles. Administrator removal
  of their role membership or deletion of the role cannot be undone by reconnecting or reassigning.
  The roles file retains private role identities across deletion and restart.
- Moving an account revokes old provider sessions and leaves one active assignment. Sticky audiences
  preserve the restrictions on previous agents and history. Disconnect disables the configuration,
  stops its sessions and deletes the credential file; protected history and role identities remain.
- One Google email is bound to one managed profile, including disconnected profiles. Reconnecting
  with another Google email is refused. Owners/admins retain their existing host privileges.

These are application permissions. They do not isolate a coding agent that can read the host's
filesystem under the same OS account. Existing host secret-storage and backup rules still apply.
Never downgrade a configured server to a build without native connector policy enforcement.

## Validation and release

`bun run test:google-connections` runs a real Team API host, real SQLite agent/MCP stores, native
roles and policy, and a separate offline OAuth callback process. It writes a report under
`.openbot-build/google-connections-e2e/`. No Google account or network token exchange is used.

The member flow currently targets the desktop client. Browser/mobile sign-in UI and a second live
Google account remain separate acceptance work. No production release is part of this source change.
Integrate the concurrently developed `feat/openai-realtime-voice` branch before a later release;
never replace that server build with this branch alone.
