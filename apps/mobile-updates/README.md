# OpenBot mobile update server

This Worker gives the mobile app its over-the-air updates at `https://updates.openbot.run`. It
answers the [Expo Updates protocol](https://docs.expo.dev/technical-specs/expo-updates-1/), version
1, for the `expo-updates` client in each store binary. It replaces EAS Update: the binaries name
this server in `updates.url` of `apps/mobile/app.json`.

How to publish, roll out and take back an update is in
[the mobile README](../mobile/README.md#over-the-air-updates). This file describes the server.

## Routes

| Route | Answer |
| --- | --- |
| `GET /manifest` | The update that the phone must run, as `multipart/mixed` with a signed `manifest` part, or a signed `directive` part that returns the phone to the bundle in its binary. `204` when the phone must keep what it runs. |
| `GET /assets/<hash>` | A bundle or an asset. The name is the SHA-256 of the file, so the answer never changes and has a one-year cache time. |

The phone sends `expo-platform`, `expo-runtime-version` and `expo-channel-name`. One binary is one
combination of these three values, and the server keeps one pointer for each binary.

## Bucket

The private R2 bucket `openbot-mobile-updates` (binding `UPDATES`) has three kinds of objects.
`src/protocol.ts` defines them, and `scripts/mobile-ota-lib.ts` writes them.

| Key | Content |
| --- | --- |
| `assets/<sha256, base64url>` | One file of an update. |
| `updates/<update id>.json` | The manifest text of one update and its signature. It never changes. |
| `pointers/<channel>/<platform>/<runtime version>.json` | What the phones of one binary get: an update with its rollout percentage and its base update, or the directive of a rollback. It also keeps the last 50 changes. |

A publish writes the files first, then the update, then the pointer. So a phone never gets a
manifest whose files are not there.

## Security

- **The Worker has no key and no write route.** `scripts/mobile-ota.ts` signs each manifest and
  each directive in GitHub Actions with the private key in the `release-mobile-ota` environment. The
  binary has the certificate (`apps/mobile/certs/certificate.pem`) and refuses a part whose signature
  the certificate does not accept. Thus a person who can write the bucket, or who has a Cloudflare
  token, cannot put new code on a phone. Such a person can stop updates or give a phone an older
  signed update again; a phone does not go back to an update that is older than the one it runs.
- **The phone checks each file.** The signed manifest has the SHA-256 of each file.
- **Request headers stay private.** A request has a random install ID (`EAS-Client-ID`) and, after
  a crash, the last fatal error text of the app (`Expo-Fatal-Error`). The Worker reads neither the
  error text nor any header that it does not need, logs no header, and stores nothing. Invocation
  logs are off in `wrangler.jsonc`, because they record request headers. Do not turn them on.
- Keep the bucket private. Do not add an R2 public development URL or a custom R2 domain.

## Cache

The Worker keeps bucket answers in the Cache API of each location: a pointer for 30 seconds, an
update for one day, a file for one year. A publish, a rollout change or a rollback thus reaches all
phones after 30 seconds at the latest. An object that does not exist is in the cache too, because
most requests come from a binary that has no update.

## Rollout

`rolloutBucket` in `src/protocol.ts` gives each install a place from 0 to 99 for each update, from
the install ID and the update ID. An install below the rollout percentage gets the update. The
others get the base update, or nothing. An install keeps its place while the percentage grows, and
each update takes a different part of the installs. A phone that reports the update in
`Expo-Recent-Failed-Update-IDs` does not get it again.

## Checks

```bash
bun run typecheck:updates
bun run test:mobile-ota
```

`test:mobile-ota` (`scripts/mobile-ota-e2e.ts` in this folder) runs the Worker code on a local R2
bucket with the real publish commands, then asks for updates as a phone does. It writes
`.openbot-build/mobile-ota-e2e/report.json`. Under Bun, the local bucket cannot stream an object
body, so the script reads each object as a whole. The deployed Worker streams.

## Deployment

`.github/workflows/mobile-updates-deploy.yml` deploys the Worker when a file in this folder changes
on `main`. It runs the two checks first, and then asks the deployed server for the empty answer.
`bun run updates:deploy` deploys by hand.

One-time setup:

1. `bun run updates:bucket:create` makes the bucket `openbot-mobile-updates`. Make
   `openbot-mobile-updates-test` in the same way for `wrangler dev`.
2. The route `updates.openbot.run` is a custom domain of the Worker. The first deploy makes its DNS
   record.
3. In the `cloudflare-production` environment of the repository, add the secret
   `CLOUDFLARE_MOBILE_UPDATES_DEPLOY_TOKEN`: a Cloudflare API token with **Workers Scripts Write**
   for the account and **Workers Routes Write** for the zone `openbot.run`. A deploy needs no more,
   and the token cannot read or write a bucket. Cloudflare has no permission for one Worker only,
   so the token can deploy each Worker of the account: keep it in this environment only. Do not use
   the token of the account Worker. The token in Cloudflare is `openbot-mobile-updates-deploy`.
4. The publish workflow needs its own credentials. See
   [the mobile README](../mobile/README.md#one-time-setup-of-over-the-air-updates).

Do not change the domain or the path `/manifest`. Each store binary has the URL, and a binary
cannot change it.
