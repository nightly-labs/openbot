# Unreleased mobile notes

The notes of the OpenBot iPhone app. They are separate from the notes of the desktop app and the
web client in [`changelog.d/`](../../../changelog.d/README.md), and the public `/changelog` page shows
them in its Mobile tab.

Each pull request that changes what a user sees in the iPhone app writes its notes in its own file
here. Name the file after the branch, with `-` for `/`: `apps/mobile/changelog.d/fix-chat-scroll.md`.
A pull request that also changes the desktop app or the web client writes a second file in
`changelog.d/`.

Use the groups and item rules of [the release notes](../../../docs/RELEASING.md#release-notes).

`bun run mobile:release:patch`, `mobile:release:minor` and `mobile:release:major` move the items of
every file into the new version section of [`apps/mobile/CHANGELOG.md`](../CHANGELOG.md), set the
new version in `apps/mobile/app.json`, `apps/mobile/package.json` and `bun.lock`, and delete the files. The
pre-commit hook and the Changelog workflow check each file. The new section is `In review`, and
`/changelog` does not show it until `bun run mobile:release:published ios` (or `android`) writes the
date of the first store. Run the command again for the other store. See
[the mobile release steps](../README.md#github-actions-testflight-release).

## OTA updates

An over-the-air (OTA) update sends new JavaScript to the phones that have a store version. The
store version does not change: an OTA update of `1.4.8` has the notes version `1.4.8.1`, the next
one `1.4.8.2`, and `apps/mobile/app.json` stays at `1.4.8`.

```sh
bun run mobile:release:ota --base <commit or tag of the store build> --platform <ios|android|all>
```

The command moves the items of the files here that are new since `--base` into a new section of
[`apps/mobile/CHANGELOG.md`](../CHANGELOG.md), directly above the store version, and deletes those
files. Its heading has the date and the platforms that get the update, such as
`## [1.4.8.1] - 2026-11-12 (Android)`, or only the date for both platforms. A file that `--base`
already has stays here for the next store version, because it can describe a change that needs new
native code. The command does not change `apps/mobile/app.json`, `apps/mobile/package.json`,
`bun.lock` or `apps/mobile/release-announcement.json`.

- `--head <ref>` is the commit of the update. The default is `HEAD`.
- `--date YYYY-MM-DD` is the day of the update. The default is today, in UTC.
- `--dry-run` shows the section and changes nothing.
- `--allow-empty` is for an update that users do not see. Without it, the command stops when no
  file is new.

The command stops when `--base` has a different version than `apps/mobile/app.json`, or when a
platform does not have the store version: the update cannot reach those phones. `/changelog` and
the app show the section as a version. It gets no Discord post, and the store update header of the
app ignores it. The pre-commit hook and the Changelog workflow check each OTA section.
