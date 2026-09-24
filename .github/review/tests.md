---
include:
  - "**/*.test.ts"
  - "**/*.test.tsx"
---

## Test review

Biome already rejects the mechanical slop shapes: snapshots, test ids, class-reached assertions,
`toHaveClass`, `toHaveStyle`, `getComputedStyle`, DOM-tree walks, `document.activeElement`, bare
sleeps, and `it.only`. Do not re-report any of those; the check has them. Judge what a pattern
cannot: whether each added test would fail for a reason a user or a caller could act on.

Report a finding when the diff:

- Adds a test whose assertions all hold even if the feature under test is deleted. Name the line you
  would remove and why the test would stay green. *Exception:* a regression test pinning an absence —
  that a retry does not fire twice, that a secret is not in the payload — is asserting exactly that.
- Adds a test whose only assertion is that a mock or spy was called. *Exception:* the call **is** the
  observable behaviour at a process or network boundary the test cannot otherwise see — an IPC send,
  a spawned provider process, an analytics event, a Team API frame. Then the finding is only worth
  reporting if the arguments go unchecked.
- Asserts on a value the same test just constructed, so the assertion restates the setup rather than
  exercising anything.
- Asserts incidental shape instead of consequence: an array's length with no claim about its
  contents, the number of keys on an object, or that rendering merely did not throw.
- Mocks the unit under test, or stubs so much of the collaborator graph that the assertion can only
  observe the mocks. *Exception:* `electron`, `electron-updater`, and `node:` built-ins have no
  injectable seam and are exempt by policy.
- Adds a unit test that no line of the PR body's "Failure modes" section names. `AGENTS.md` asks
  for that list before an isolated test; a test without one is a test written after the code.
- Adds a new test *file* for a boundary an existing file already covers, or tests the same behaviour
  at both the component and the application level. `AGENTS.md` asks for one test, preferably E2E.

Do not report a missing test unless you can name the concrete regression it would catch, and that
regression can lose user data, break a released protocol, weaken the trust boundary, or leak a
secret. `AGENTS.md` does not ask for a regression test by default. A thin test at one of those
seams is not a finding for being thin.
