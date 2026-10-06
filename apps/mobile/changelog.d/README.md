# Unreleased mobile notes

The notes of the OpenBot iPhone app. They are separate from the notes of the desktop app and the
web client in [`changelog.d/`](../../changelog.d/README.md), and the public `/changelog` page shows
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
`/changelog` does not show it until `bun run mobile:release:published` writes its date.
