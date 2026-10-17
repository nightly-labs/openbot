### Security

- A member that the owner or an admin removed could rejoin a server with an invitation or a team link from before the removal. Now that member needs a new invitation or a reactivation. A member who left by their own choice can still rejoin with an earlier invitation.
- An invitation from an admin stayed valid after the admin left, was removed or was demoted. Now it closes, and it no longer counts against the invitation limits.
- If the public ticket key set had a private key by mistake, `/.well-known/jwks.json` published the private key. Now it publishes only the public members.
- A checkout return address that starts with `//` or `/\` could send the browser to another site. The account server never made such an address, but now it refuses one.
- A hosted site address such as `/constructor` made the site router read storage for a file that does not exist. Now the router finds only the files of the site.
- A request with no Cloudflare client address got its rate limit key from `X-Forwarded-For`, which the client sets. Now only the Cloudflare address sets the key.
- An IPv6 client got a new per-address rate limit for each address in its /64. Now all addresses of one /64 share a limit.
- Signal read the full body of a Slack request or an account event before it checked the size. Now it stops reading at the limit and answers 413.

### Fixed

- `PRIVACY.md` now lists the hosted site files, marketplace skill bundles and site reports that the account service stores.
