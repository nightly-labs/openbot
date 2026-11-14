# Umbrel

The Umbrel app runs the [OpenBot image](docker.md) on an [Umbrel](https://umbrel.com) home server. It
is a [self-hosted server](self-hosted-server.md) of your account. You use it from the desktop app, the
iPhone app or `openbot.run/app`, as any other server.

The app is not in an Umbrel app store yet. The files are in `docker/umbrel/openbot`.

## Sign in

1. Install the app and open it from the Umbrel home screen.
2. The setup page shows the sign-in screen of the app. Enter your email and select
   **Send sign-in code**.
3. Enter the code that OpenBot sends to the email. The page signs in when the code is complete.
4. The page shows when the server is online. Then open OpenBot on your computer, on your phone or at
   `openbot.run/app`, sign in with the same email and select the server.
5. Connect a provider from the app, as on a [hosted server](hosted-servers.md#providers).

The server gets the name `OpenBot`. To change it, open Server Settings in the app.

The setup page can only show the status and sign the server in. To sign out, or to use another
account, open a terminal of the app in Umbrel (Settings › Advanced settings › Terminal) and run
`openbot logout`. The other commands of [Commands](docker.md#commands), such as
`openbot mobile-connect` and `openbot login --claim`, are also there.

## The setup page

`OPENBOT_SETUP_PAGE_PORT` starts the page in the container. The page is part of OpenBot:
`src/main/server-setup-page.ts` serves the `server-setup` entry of the renderer build
(`out/renderer/server-setup.html` and its `assets/`). The entry,
`src/renderer/src/features/server-setup/`, shows the shared `AccountLogin` screen of the app. It starts only in the OpenBot image, where `/opt/OpenBot/hosted/mode`
is `container`. A self-hosted server that systemd runs writes a warning and does not start it.

Umbrel's `app_proxy` asks for the Umbrel password before it sends a request to the page. The page
listens on all addresses of the container, so other apps on the Docker network of Umbrel can reach it
without that password. For this reason the page:

- has only three requests: the status, send a code, and sign in with the code. It has no sign-out,
  server claim, rename or Mobile Connect code.
- refuses a sign-in and a code when the server is signed in. Another app cannot move the server to
  its own account or remove its session.
- accepts a code only for the current sign-in. Another app cannot complete an older sign-in of its own
  after you ask for a code.
- accepts a request only with its own `x-openbot-setup` header, as a form, and from its own origin
  when the browser tells the origin. A page of another site cannot send one from your browser.
- shows no secret. It shows the email of the account and the server name.
- serves only its page and the files of the build in `assets/`, with the content security policy of
  the app window and no outside source.

Until the server is signed in, another app on that network can sign it in to its own account first.
Sign in right after you install the app. The page then shows the email of the account that owns the
server.

The page uses the language and the color scheme of the browser.

## Updates

Umbrel installs a new version of the app when the app store has one. A new version of the app pins a
new image by its digest. OpenBot does not update itself in the container, and Server settings ›
Updates offers no update. Do not go back to an older version: see [Upgrades](docker.md#upgrades).

## Make the app for a release

```sh
bun scripts/umbrel-app.ts --version <x.y.z>
```

The script writes `.openbot-build/umbrel/openbot`: the manifest and the Compose file with the version
and the digest of the image index on GHCR, the `pre-start` hook and `seccomp.json`. Copy the folder to
an app store as `openbot`. The release must contain the setup page: 0.70.0 and older releases do not.

| File | Use |
| --- | --- |
| `umbrel-app.yml` | The manifest. Umbrel opens the app on port 4180. |
| `docker-compose.yml` | The container, with the same options as `docker/compose.yaml`. `app_proxy` sends the requests to the setup page on port 8080. |
| `hooks/pre-start` | Makes the data folder and gives it to UID 1000, the user of the image. |
| `seccomp.json` | A copy of `docker/seccomp.json`. The container stops without it, see [Security](docker.md#security). |

`bun run test:server-setup-page` runs the setup page with a fake account service in Chrome and
writes `.openbot-build/server-setup-page-e2e/report.json`.

## Not confirmed

- The app was not installed on umbrelOS. The Compose file uses
  `security_opt: seccomp=${APP_DATA_DIR}/seccomp.json`. No app in the official Umbrel store sets a
  seccomp profile, so it is not known if Umbrel accepts it or if its review allows it.
- umbrelOS was not checked for AppArmor rules that refuse user namespaces. On such a host, the
  container stops at its start, as on Ubuntu 23.10 or newer (see [Not confirmed](docker.md#not-confirmed)).
- The terminal of the app in Umbrel was not tested with `openbot logout`.
- Umbrel backups of the app data were not tested. A backup must have all of `/data`, see
  [Data](docker.md#data).
