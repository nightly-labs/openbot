# OpenBot Slack manager app

Slack CLI projects for the manager app. The desktop host uses its user token to create one Slack app
for each agent (`apps.manifest.create`). No code runs here: each directory holds only the manifest.

| Directory | App | App ID | Home team | Redirect URL |
| --- | --- | --- | --- | --- |
| `production` | `OpenBot` | `A0C5H5C95NH` | `openbotdev` (`T0C5B1XG542`) | `https://api.openbot.run/v2/slack/manager/callback` |
| `development` | `OpenBot (dev)` | `A0C5G5XGS83` | `openbotdev` (`T0C5B1XG542`) | Test Worker (`bun run deploy:test`) |

`.slack/apps.json` links each directory to its app. Run the Slack CLI from inside a directory.

## Scopes are blocked until Slack enrolls the home team

Slack refuses `app_configurations:read` and `app_configurations:write` (`illegal_user_scopes`) for an
app that is not an enrolled manager app. The apps were created without user scopes. `manifest.json`
holds the target manifest, with the scopes. After Slack enrolls `T0C5B1XG542`, apply it:

```sh
cd apps/slack-manager/production
slack manifest validate --app A0C5H5C95NH
slack manifest sync --app A0C5H5C95NH
```

Do the same in `development` with `--app A0C5G5XGS83`.

## Manual settings

The manifest cannot set these. Use `slack app settings --app <id>`:

- **Manage Distribution**: turn on public distribution.
- **Basic Information**: copy the client ID and client secret to the Worker
  (`SLACK_MANAGER_CLIENT_ID`, `SLACK_MANAGER_CLIENT_SECRET`). Use the development app's values for
  the test Worker only.
- **Basic Information**: set the app icon.

Do not install the manager app in its home team. Workspaces install it through
`POST /v2/slack/manager/authorize`. `slack app install` stops with a nil pointer error on an app
with no scopes; the app is created before the error.
