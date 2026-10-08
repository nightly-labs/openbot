# Direct connection over Tailscale

A joined server is usually reached through the OpenBot cloud: the account service gives a ticket,
Signal sets up WebRTC, and then the client talks to the host. These steps take some seconds at each
start. When the client and the host are in the same [Tailscale](https://tailscale.com) network
(tailnet), the client can reach the host directly instead. The OpenBot cloud stays the fallback.

OpenBot does not sign in to Tailscale and keeps no Tailscale credential. It uses the Tailscale app
that is already installed and signed in on each computer.

## Turn it on (host)

1. Install Tailscale on the host computer and sign in.
2. In the Tailscale admin console, turn on MagicDNS and HTTPS certificates for the tailnet.
3. In OpenBot on the host, open **Server settings > General > Tailscale** and turn on **Direct
   connection over Tailscale**.

The section shows the state of Tailscale on the host: not installed, not running, signed out, turned
off, or connected (with the tailnet and the device name). While the host is published and the switch
is on, the section shows the direct address, for example `https://studio-mac.tail4b2c1.ts.net`.

On Linux, `tailscale serve` needs operator rights for the user that runs OpenBot:
`sudo tailscale set --operator=$USER`. If the command is refused, the section shows the first line
of its error.

## Use it (member)

There is nothing to set up. A member's OpenBot asks a connected host for its direct address and
keeps it. At the next connection, when Tailscale on the member's computer can see the host device,
OpenBot uses the direct address first. The server menu shows **Direct · Tailscale** or **Via OpenBot
cloud**. **Server settings > General > Tailscale > Use Tailscale when available** turns it off for
one server.

When the two computers are in different tailnets, the host owner can share the host device with the
member in Tailscale ([node sharing](https://tailscale.com/kb/1084/sharing)). Until then the server
uses the OpenBot cloud, and the settings say why.

The remote desktop and the live browser view always use WebRTC.

## How it works

Host:

- The Team API still listens on `127.0.0.1` only (`src/main/listen-loopback.ts`). With the switch
  on, a second loopback listener opens, and OpenBot runs
  `tailscale serve --bg --https=<443 or 8443> http://127.0.0.1:<port>`. Tailscale accepts the
  connection inside the tailnet and gives it TLS with the device certificate. OpenBot never runs
  `tailscale funnel`. If Funnel publishes the port, OpenBot takes the port down again.
- OpenBot uses port 443, or 8443 when 443 is in use. It changes a port only when nothing is
  configured there, or when the port forwards to the address that OpenBot set up last
  (`openbot-tailscale-direct-v1.json` in the app data). When the switch goes off or the host stops,
  OpenBot runs `tailscale serve --https=<port> off` only if the port still forwards to its address.
- The `tailscale` command is run without a shell, with a fixed argument list, a 10 second deadline
  and closed standard input (`src/main/tailscale-cli.ts`). Only the port numbers change.
- The direct listener answers only `GET /v1/compatibility`, `GET /v1/identity`,
  `POST /v1/auth/account`, and the routes that need a member token. It has no password, invitation
  or join route. The remote screen and browser view routes answer 404 there; the remote screen
  readiness is the exception.
- A sign-in there redeems one account ticket with the account service, reads the member list from
  the account service again, and opens a direct session. A direct session is in memory only, lasts
  24 hours, and is valid only on the direct listener. Each request reads the member again, so a
  removed or disabled member is refused at once. The host's session list shows direct sessions, and
  revoking one ends it.
- Members learn the address through the optional capability `direct-endpoint-v1`
  (`POST /v1/direct-endpoint`, answer `{ "url": string | null }`), frozen in
  `packages/contracts/src/team-protocol/direct-endpoint-v1.ts`. A host or client without it does not
  change.

Client:

- The address is an optional field of the saved server (`directUrl`), with the member's choice
  (`directDisabled`). An older build reads the entry and drops both fields.
- A connection first checks that Tailscale on this computer lists the host device. Then it proves
  the host: the host signs a new challenge with the Ed25519 key that is pinned for the server, the
  same key that the WebRTC handshake checks. Only after this does the client get one account ticket
  and send it to the address. The whole step has a 4 second deadline.
- A failure, a different key, a device in another tailnet or a dropped direct connection moves the
  server to WebRTC, and the direct path is not tried again for 5 minutes or until the member retries.
- The direct token is kept in memory and is renewed before 24 hours with a new account ticket.

## Limits

- The identity proof is not bound to the TLS session. On the direct path the peer is already
  authenticated by WireGuard and the address has a Tailscale certificate for that device only.
- A direct sign-in needs the account service for the ticket and the member list. Later requests do
  not.
