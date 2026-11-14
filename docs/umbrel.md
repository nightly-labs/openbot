# Umbrel

The Umbrel app runs the [OpenBot image](docker.md) on an [Umbrel](https://umbrel.com) home server. It
is a [self-hosted server](self-hosted-server.md) of your account. You use it from the desktop app, the
iPhone app or `openbot.run/app`, as any other server.

## Install

The app is in the OpenBot community app store,
[nightly-labs/openbot-umbrel-store](https://github.com/nightly-labs/openbot-umbrel-store). It is not in
the official Umbrel App Store yet.

1. On your Umbrel, open the **App Store**.
2. Open the **⋯** menu at the top right and select **Community App Stores**.
3. Paste `https://github.com/nightly-labs/openbot-umbrel-store` and select **Add**.
4. Open the **OpenBot** store and install **OpenBot**.

Umbrel keeps the data of an app in a folder with the name of its app id, here `openbot-server`. An
OpenBot app from another store has another id and does not get that data.

## Sign in

1. Open the app from the Umbrel home screen.
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

Umbrel asks for the Umbrel password before it sends a request to the page. The `app_proxy` service
of the Compose file does this on older umbrelOS. umbrelOS 2.0 removes that service and its own app
gateway does it. The page
listens on all addresses of the container, so other apps on the Docker network of Umbrel can reach it
without that password. For this reason the page:

- has only four requests: the status, send a code, sign in with the code, and retry after an account
  error. It has no sign-out, server claim, rename or Mobile Connect code.
- refuses a sign-in and a code when the server has a session, also a session that the account service
  has not confirmed yet. Another app cannot move the server to its own account or remove its session.
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
bun scripts/umbrel-app.ts --version <x.y.z> [--id <app id>]
bun scripts/umbrel-app.ts --version <x.y.z> --official [--submission <pull request URL>]
```

The script writes `.openbot-build/umbrel/<app id>`: the manifest and the Compose file with the app id,
the version and the digest of the image index on GHCR, the empty `data` folder, the `pre-start` hook
and `seccomp.json`. Copy the folder to an app store, with the app id as its name. The app id is `openbot` by default. In a community
app store, the app id must start with the id of the store. The release must contain the setup page:
0.71.0 and older releases do not.

The community app store makes its app, `openbot-server`, with this script. Its workflow
`update.yml` looks for a new release each six hours, runs the script of that release with
`--id openbot-server` and commits the folder. It skips a release whose templates have no app id, and it
never goes to an older release. Umbrel offers the update when the store has it. To make the app now,
run the workflow from the Actions tab of the store.

| File | Use |
| --- | --- |
| `umbrel-app.yml` | The manifest. Umbrel opens the app on port 4180. The icon is `openbot.run/icon-512x512.png`, except with `--official`. |
| `docker-compose.yml` | The container, with the same options as `docker/compose.yaml`. Umbrel sends the requests of the app to the setup page on port 8080. |
| `data/.gitkeep` | Keeps the source folder of the `/data` bind mount in the app store. Umbrel's linter needs it. |
| `hooks/pre-start` | Makes the data folder and gives it to UID 1000, the user of the image. |
| `seccomp.json` | A copy of `docker/seccomp.json`. The container stops without it, see [Security](docker.md#security). |

### The official Umbrel App Store

`--official` writes the app for [getumbrel/umbrel-apps](https://github.com/getumbrel/umbrel-apps):
the id `openbot` and no `icon` line, because Umbrel keeps the icons and the gallery of that store in
another repository. Umbrel adds the gallery images. `--submission` writes the URL of the pull request
to that store in the manifest. Umbrel's linter accepts the package when it has that URL:

```sh
npm run lint:apps -- openbot --check-images
```

Write these reasons in the pull request, because Umbrel asks for them:

- `security_opt`: the Electron sandbox in the image makes user namespaces. The default seccomp profile
  of Docker refuses the calls for it, and the container stops. `seccomp.json` is the default profile
  with one more rule: `clone` and `unshare` without limits on their flags (see
  [Security](docker.md#security)). `no-new-privileges` is also set.
- `restart: unless-stopped`: OpenBot exits with code 0 when an owner restarts the server from Server
  Settings. With `on-failure`, the app then stays stopped.

`bun run test:server-setup-page` runs the setup page with a fake account service in Chrome and
writes `.openbot-build/server-setup-page-e2e/report.json`.

## Tests on umbrelOS

The app was tested on umbrelOS 2.0.2 in a container (`ghcr.io/getumbrel/umbrelos`, arm64, Docker
Desktop on macOS), with the setup page of this branch on the 0.71.0 image:

- umbreld installed `openbot-server` from the community app store. It accepted `seccomp.json`, and the
  `pre-start` hook gave the data folder to UID 1000 with mode 0700. The Electron sandbox started.
- Without an Umbrel sign-in, the app port sends the browser to the Umbrel sign-in. After it, the setup
  page shows the sign-in screen of OpenBot.
- After a restart of the app in umbreld, the data and `openbot.db` stay.
- `openbot logout` runs in the app container.
- Umbrel's linter (`lint:apps`) shows no errors on the `--official` app with a submission URL.

## Not confirmed

- The app was not installed on an Umbrel Home, a Raspberry Pi or an x86_64 computer. It is not known if
  Umbrel's review accepts `security_opt: seccomp=${APP_DATA_DIR}/seccomp.json`. No app in the official
  Umbrel store sets a seccomp profile.
- AppArmor was not checked. The kernel of the test has no AppArmor. On a host with AppArmor rules that
  refuse user namespaces, the container stops at its start, as on Ubuntu 23.10 or newer (see
  [Not confirmed](docker.md#not-confirmed)).
- The Terminal page of Umbrel was not opened. `openbot logout` was run with `docker exec` in the app
  container.
- The store was added with the API of umbreld, not in the App Store page. The store has no app before
  the first release with the setup page, so the test copied the app into the clone of the store.
- Umbrel backups of the app data were not tested. A backup must have all of `/data`, see
  [Data](docker.md#data).
