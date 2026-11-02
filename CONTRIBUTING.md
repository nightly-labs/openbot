# Contributing to OpenBot

Thanks for helping improve OpenBot. Pull requests with clear verification are the easiest to
review.

## What you can send

These rules apply to people outside the `nightly-labs` organization. Organization members and
users with write access to this repository skip them. So do their agents, which act as
`openbotgit[bot]` through the OpenBot GitHub App.

You can open a pull request without an issue for:

- Bug fixes.
- Small improvements, alignments, and clean-ups that do not change how a feature works.
- Translations and documentation.
- A new provider, MCP app, or connector. Follow
  [Integrations](docs/architecture/integrations.md) ("Add a provider", "Add an application",
  "Add a connector").

These need an issue with the `approved` label before you write code:

- New features.
- Changes to how an existing feature works or looks.
- Large refactors, new dependencies, and changes to migrations, IPC contracts, the Team API,
  security boundaries, or CI.

To propose one, open a [feature request](https://github.com/nightly-labs/openbot/issues/new?template=feature_request.yml)
and wait. A maintainer adds `approved` when the change fits OpenBot. Then link the issue in your
pull request with `Closes #<number>`.

The `Contribution policy` workflow applies these labels:

| Label | Meaning |
| --- | --- |
| `external` | The author is outside the organization. The workflow adds it. |
| `needs-approved-issue` | A maintainer decided that the pull request needs an approved issue. The `Contribution policy` check fails until the pull request closes an issue with the `approved` label. If it does not do this in 7 days, the workflow closes the pull request. |
| `approved` | A maintainer accepts the issue. Pull requests that close it pass the check. |
| `policy-exempt` | A maintainer turned off the check for this pull request. |

A maintainer who reopens a closed pull request starts a new 7-day period.

## Before opening an issue

- Use an issue form. The workflow closes an issue from outside the organization that does not
  come from a form or that has an empty required answer.
- Search existing issues first.
- Use Discussions for questions and for ideas that are not yet a specific request.
- Use the security process in `SECURITY.md` for vulnerabilities.
- Remove credentials, private file paths, conversation contents, and personal data from diagnostics.
- For a bug, give the platform, the OpenBot version, the operating system, the provider and its CLI
  version, the exact steps, and the expected and actual results. The bug form asks for each one.

## Development setup

```bash
git clone https://github.com/nightly-labs/openbot.git
cd openbot
bun install --frozen-lockfile
bun run check
bun run dev
```

Coding agents skip `bun run check`: see [AGENTS.md, Checks](AGENTS.md#checks).

The supported toolchain is pinned in `package.json`. Use stable Bun 1.4.2, TypeScript 7, Vite 7, and the
existing Biome configuration. Biome is the only lint and format tool. Do not add a second linter,
Prettier, a second state library, or a UI kit without first discussing the architectural cost.
The Biome configuration also loads the repository-owned GritQL rules in
`tools/biome/anti-slop/rules`. Fix these findings at the domain boundary. Do not suppress a rule or
replace a concrete contract with a broad dictionary type.

Biome's `suspicious/noImportCycles` rejects circular imports across the whole repository, so runtime
imports point in one direction. When two modules need each other, move the shared piece into a third
module both can import — as `features/conversation/conversation-controller-context.tsx` does for the
conversation controller, and `features/team/team-typing.ts` for the one IPC call two differently
scoped owners both need.
Type-only imports (`import type`) are erased by the compiler and stay allowed in both directions.

## Pull requests

1. Make sure that the change is one you can send: see [What you can send](#what-you-can-send).
2. Create a branch from `main`.
3. Test behavior changes and reproduced bugs as [AGENTS.md, Tests](AGENTS.md#tests) describes.
4. Run `bun run check`. Coding agents do not: see [AGENTS.md, Checks](AGENTS.md#checks).
5. Describe user-visible changes, risks, and manual verification in the pull request. Link the
   issue that the pull request closes.

Do not commit generated `out`, `dist`, coverage, local browser profiles, Electron `userData`, CLI
state, `.env` files, credentials, real conversations, or user attachments.

## Writing guides

Public guides live in `apps/auth-api/src/content/guides/`. To add one:

1. Write the body as a TSX component in that directory, using the article slug for the file name.
2. Add the article metadata to `apps/auth-api/src/lib/guides.ts` and the body to
   `apps/auth-api/src/content/guides/index.ts`.
3. Run `bun run api:images` and commit the generated files in `apps/auth-api/content-art`.
4. Open the guide in a local preview and check the guide index, article page, feed and social card.

Write for someone who has OpenBot open and is trying to complete a task. Use short paragraphs, plain English and the
exact names of buttons, settings and files. Keep product claims tied to the current app. Use `ArticleImage` only
when the picture adds information that the text does not.

Use `OPENBOT_LINKS` for external links and include useful `alt` text for every image. Do not paste bare URLs into a
guide.

### Answering the NorbiAI review

Every push to a branch in this repository runs the automated reviewer, and it blocks the merge on
an unresolved P0 or P1 finding. A pull request from a fork is the exception: GitHub gives a fork's
push run a read-only token, so it could not publish a review even if it produced one. Ask a
maintainer to add the `norbiai` label, or to comment `/norbiai review`. Both run this
repository's own copy of the workflow, where the token can publish, and either can be repeated
after a push — the label is removed once the review runs, so re-applying it asks again. Two ways
past a finding:

1. Fix it and push. The next review classifies the finding `[RESOLVED]`.
2. Show it is wrong. Comment the concrete reason — the guard it misses, the line that already
   handles it — and include `/norbiai review` anywhere in the same comment. The reviewer rechecks
   that finding against your argument and marks it `[WITHDRAWN]`, which stops blocking and stays
   recorded under `## Withdrawn Findings` so a later push does not raise it again.

A rebuttal needs something checkable in it. "Intended", "out of scope", or a promise to fix it
later leaves the finding `[REMAINS]`, and the reviewer says which part it could not verify. Only
comments from someone who can merge the pull request are read — organization membership on its own
is not enough, and on a fork that means the recheck has to be asked for by a maintainer rather than
by you — and only those written after the review being answered, plus the comment that asked for
the recheck whatever its timestamp says. That one is passed to the reviewer whole; the older
responses share a size budget and are dropped from the oldest end. A label carries no argument of
its own, so write the rebuttal as a comment first and label afterwards.

### The reviewer

Every review runs on `claude-opus-5-5` at `high` reasoning effort, on Claude Code with the Claude
login on the runner mac. This is set in
[`.github/workflows/norbiai-review.yml`](.github/workflows/norbiai-review.yml). A pull request, a
review request or the changed files cannot choose another model or effort. A slow review on a very
large diff can reach the job's time limit: split the pull request.

A review after a push reads only the commits since the last successful review, and rechecks the
earlier findings against the full current code. A rebuttal on an unchanged commit reads no new code.
The first review, a review after a rebase or a merge of the base branch, and a review asked for with
the `norbiai` label read the whole pull request. Add the label when a change since the last review
needs the whole pull request read again.

Claude Code can only read: it gets the Read, Grep and Glob tools and the `git diff`, `git show`,
`git log` and `git ls-files` commands. It does not load the pull request's own settings, hooks,
`CLAUDE.md` or MCP servers.

## Security-sensitive changes

Preserve the following boundaries, and their tests where they exist:

- Electron sandboxing, context isolation, navigation policy, and IPC sender validation.
- Attachment realpath, MIME, size, quota, and managed-protocol checks.
- Queue serialization, idempotency, crash reconciliation, and atomic persistence.
- The remote browser session's lack of preload and `window.openbot` access.
- Secret redaction and agent child-process cleanup.

Full agent access is intentional today, but new privileges or network surfaces still require an
explicit threat-model note in the pull request.

## Translations

English is the source text. A French or Japanese catalog can be partial: a key it does not have
shows in English. To add a key, a translation or a language, follow [docs/i18n.md](docs/i18n.md) and
run `bun run i18n:check`.

## Dependencies

Prefer the platform and existing dependencies. A new runtime dependency should remove more
complexity than it adds, have a compatible open-source license, and be justified in the pull request.

Bun does not resolve a version that is less than 3 days old (`minimumReleaseAge` in `bunfig.toml`),
and Dependabot waits the same time. Only `@norbert_bodziony/bloub`, which the maintainer publishes,
is excluded. Only the packages in `trustedDependencies` in `package.json` can
run install scripts. If a new dependency needs its install script, add it to that list and give the
reason in the `bunfig.toml` comment. `bun pm untrusted` shows the blocked scripts.

## Licensing

Each author of a pull request must sign the
[OpenBot Contributor Assignment Agreement](CLA.md). The agreement assigns the copyright in your
contributions to Synthetify Labs spółka z ograniczoną odpowiedzialnością. Organization members,
users with write access to this repository and bots do not sign.

To sign, tick the agreement box in the description of your pull request. The pull request template
has no box, because most authors do not sign. When you must sign, the `CLA` workflow adds the box to
the end of the description. A coding agent ticks the box only when you tell it to. An author of a
commit in a pull request that a different person opened signs with a comment instead, as section 10
of the agreement says. You sign one time for each version. The `CLA` workflow records the signature on the `cla-signatures` branch
and sets the `CLA` status. Its rules are in `scripts/cla.ts`. Each commit author email must be
linked to a GitHub account, so that the workflow can find who must sign.

A contribution must be your original work, or you must identify the source and the license of the
material that you did not write. Do not submit copied UI assets, proprietary code, private plugin
binaries, or material whose license is unclear.
