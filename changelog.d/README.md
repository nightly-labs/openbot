# Unreleased notes

Each pull request writes its release notes in its own file here, so two pull requests never change
the same lines of `CHANGELOG.md`. Name the file after the branch, with `-` for `/`:
`changelog.d/fix-web-empty-bubbles.md`.

Use the groups and item rules of [the release notes](../docs/RELEASING.md#release-notes). A file can
have more than one group:

```md
### Fixed

- Show the full server name in the mobile server list. Before, the name stopped after 20
  characters.
```

`bun run release:patch`, `release:minor` and `release:major` move the items of every file into the
new version section of `CHANGELOG.md`, in the order that the pull requests merged, and delete the
files. The pre-commit hook and the Changelog workflow check each file. A pull request with no change
that a user can see gets the `no-changelog` label.
