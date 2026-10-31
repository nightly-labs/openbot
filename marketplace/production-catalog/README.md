# OpenBot team launch catalog

Version v4 contains 41 Skills and 27 Agents. The `pstack` Skill installs 52 skills `pstack-<name>` with it. Four Skills and four Agents are featured on first publication. All entries show the public OpenBot logo as their creator badge, use the publisher **OpenBot**, and start with zero installs. An Agent's `routines` in `catalog.json` use the Marketplace routine shape, and the build checks them as the account service does. The schedules use the installer's timezone.

Each Agent has one job and a named result, in its title. Its instructions name two input paths (a tool such as the browser, an installed plugin or the repository; else pasted or uploaded material), one approval gate, the evidence each claim needs, a fixed rubric for judgment work, and the adjacent work that belongs to another Agent. Agents with a routine install it active. A routine first reads its saved setup. With no setup, the first run sends one short setup request and later runs stay quiet; a run with nothing new calls `routine_no_update` and sends no message. Dr. Eggbot's two healthchecks still install paused. State that an Agent keeps, such as a saved site address or a care log, goes in a shared data table named for what it holds, on the user's computer.

The Skills work from supplied material and available tools; they do not assume a connected inbox, CRM, ad account, or phone service. The `pstack` Skill is the exception: it is the upstream text, unchanged in substance, and some of its skills use MCP servers, connectors or web links when the agent has them.

## Review locally

```sh
bun run api:migrate:local
bun run marketplace:seed:local
bun run dev --isolated
```

Reuse the dev app if it is already running. Open Marketplace and search **OpenBot** in Skills or Agents. Local seeding adds approved catalog records to this worktree's local account database and bundles to its local preview bucket. It does not reset the Electron profile, erase other listings, or create local Agents. Install an Agent from Marketplace to use it.

## Prepare and publish

```sh
bun run marketplace:build
bun run marketplace:publish:production
```

The build writes deterministic ZIP bundles, one SVG icon per Skill, manifests, notices, and checksums to `out/marketplace-production/v4`. A Skill icon is the artwork of its category, so a listing reads as a set; the mark uses paths, not emoji, because a reader's computer may not carry the font. The publish command without flags is an offline dry run. Review the catalog and ensure the account database has migrations through `0019_marketplace_presentation.sql` before production publication.

To publish after review, authenticate Wrangler for the production account and provide `SKILLS_ADMIN_TOKEN` through the environment, then run:

```sh
bun run marketplace:publish:production -- --apply --confirm-production
```

The publisher verifies the production admin credential before writing, uploads immutable bundle and icon keys, then inserts approved Skills and Agents with their exact skill-version dependencies. It does not go through community submission limits or pending review. `--local --apply` targets only local storage; mixing local and production flags is rejected.

## Repeating and updating

Stable IDs prevent duplicate listings. Repeating the same version preserves install counts and any existing Featured choice. A seed for an older version cannot move an approved listing back from a newer version. Existing bundle versions remain available to installed Agents.

After a version has been seeded or published, increase `catalogVersion` before changing its content. Content hashes are part of immutable version IDs; changing content while reusing a numeric version intentionally fails the database uniqueness constraint. Each Agent snapshot pins its Skill versions. Existing local installations update only through the normal Marketplace update action.

## Retiring an Agent

Move the slug from `agents` to `retired.agents` in `catalog.json` and increase `catalogVersion`. The build fails when a slug is in both lists. The publisher sets the listing's approved version to none and clears Featured, so Marketplace no longer shows it and offers no update for it. Its versions and bundles stay, and installed copies keep working as local Agents. To list the slug again, move it back to `agents`; the next publication approves its new version. The publisher sets Featured only when it creates a listing, so set Featured again with `PATCH /v1/marketplace/agents/admin/featured/<id>`.

v4 retires `product-design-lead`, `communications-partner`, `meeting-assistant`, `account-research-partner`, `outreach-writer` and `operations-planner`. Their jobs moved to Design Critic and Prototype Builder, Copy Editor, Chief of Staff, Prospect Researcher, and Ops Digest. The other v3 Agents keep their slugs with a new name, so their installs get the normal update offer.

Do not use the separate `skills:seed`, `agents:seed`, or `dev:seed` demo scripts to populate production. They serve development fixtures, not this launch catalog.

## Agents

| Agent | Slug | Category | Result | Skills | Routines |
| --- | --- | --- | --- | --- | --- |
| Change Reviewer ★ | `code-review-partner` | coding | Bugs that will break, with trigger and fix — before you merge | `change-review`, `secure-code-guidance` | — |
| Bug Fixer | `debugging-partner` | coding | From a bug report to a fix that is proven on the original failure | `bug-triage`, `change-review` | — |
| Security Reviewer | `application-security-reviewer` | coding | Security risks ranked by impact, each with code evidence and a fix | `secure-code-guidance`, `repository-threat-model` | — |
| QA Tester | `qa-tester` | coding | Pass or fail for a release, with screenshots and repro steps | `acceptance-check`, `bug-triage` | weekdays 09:00 |
| PR Shepherd | `pr-shepherd` | coding | Open pull requests kept moving to green; you only decide what to merge | `pr-follow-up`, `change-review` | weekdays 10:00; weekdays 15:00 |
| Skill Smith | `skill-smith` | automation | An API or a repeated task turned into a tested OpenBot skill | `api-skill-builder` | — |
| Scope Writer ★ | `project-partner` | productivity | A dated scope with what is in, what is out and how done is measured; work waits for your approval | `project-plan`, `decision-quality-check` | — |
| Prototype Builder | `prototype-builder` | design | A clickable prototype of your idea, with click-path screenshots and a short video; published only when you say | `prototype-build`, `distinctive-frontend-design` | — |
| Launch Coordinator ★ | `launch-coordinator` | productivity | Release notes from merged work and a launch checklist with owners and checks, kept as a draft | `launch-notes`, `project-plan` | — |
| Design Critic | `design-critic` | design | Ranked, concrete fixes for a screen from a screenshot, a live page or a Figma frame; never edits your files | `interface-critique` | — |
| Accessibility Desk | `accessibility-desk` | design | Copyable alt text for your images and a page audit with WCAG 2.2 criteria and evidence for each finding | `alt-text`, `accessibility-audit` | — |
| Handoff Spec Writer | `handoff-spec-writer` | design | A build spec from a design frame, with components, tokens, states and every value that drifts from the system | `build-spec`, `interface-critique` | — |
| Copy Editor | `copy-editor` | documents | Your draft in your own voice, with a change log that gives the reason for each edit | `voice-edit` | — |
| Search Content Planner | `search-content-planner` | documents | Writer-ready briefs for search results and AI answers, from your keywords or Search Console | `search-content-brief`, `competitor-comparison` | — |
| Campaign Analyst | `campaign-analyst` | data-analytics | What drove the change in your campaign results, and the next 1 to 3 experiments to run | `campaign-analysis`, `data-quality-review` | Mondays 09:00 |
| Prospect Researcher | `prospect-researcher` | research | Companies that match your ideal customer, with evidence and a first message to each; nothing sends | `account-brief`, `outreach-draft`, `evidence-brief` | — |
| Call Coach | `call-coach` | other | A scored sales call with quoted evidence and the top 3 fixes for the next call | `call-scorecard` | — |
| Research Desk ★ | `research-analyst` | research | Sourced, dated answers with facts kept apart from inference | `evidence-brief`, `competitor-comparison` | — |
| Support Reply Desk | `customer-support-partner` | documents | A customer reply draft, an internal note, and a complete escalation when one is needed | `support-reply`, `bug-triage` | — |
| Interview Coordinator | `hiring-partner` | other | Interview loops with prep packs, anchored scorecards and an evidence-only debrief | `hiring-scorecard`, `meeting-actions` | — |
| Chief of Staff | `chief-of-staff` | productivity | A one-screen morning brief: meetings with prep, commitments due, replies waiting | `daily-brief`, `meeting-actions` | weekdays 08:00 |
| Spend Auditor | `spend-auditor` | data-analytics | Unused seats, duplicates and near renewals in your software spend, each with evidence and the saving | `spend-audit`, `data-quality-review` | day 1 of each month 09:00 |
| Request Triage Desk | `request-triage-desk` | automation | Yes, maybe or no for each event, sponsorship or speaking request, with scores and a reply draft | `request-scoring` | — |
| Ops Digest | `ops-digest` | automation | A Friday digest of overdue, due, done and new operations items | `workflow-playbook` | Fridays 15:00 |
| Home Care Log | `home-care-log` | other | A private care log for plants, pets and filters, with a weekend due list | `care-log` | Saturdays 09:00 |
| Bill Tracker | `bill-tracker` | other | Recurring charges, price changes and renewals from your statements, with the statement lines | `recurring-charges` | Mondays 09:15 |
| Dr. Eggbot | `dr-eggbot` | automation | Designs focused agents, skills and routines | `agent-designer`, `eggbot-getting-started`, `routine-healthcheck`, `agent-chat-healthcheck`, `working-with-teammate-agents`, `pstack` | weekdays 08:44 (paused); Mondays 08:49 (paused) |

## Skills

| Skill | Category | Source |
| --- | --- | --- |
| [secure-code-guidance](skills/secure-code-guidance/SKILL.md) | coding | openai |
| [repository-threat-model](skills/repository-threat-model/SKILL.md) | coding | openai |
| [distinctive-frontend-design](skills/distinctive-frontend-design/SKILL.md) | design | anthropic |
| [internal-communications](skills/internal-communications/SKILL.md) | documents | anthropic |
| [decision-quality-check](skills/decision-quality-check/SKILL.md) | productivity | anthropic |
| [change-review ★](skills/change-review/SKILL.md) | coding | openbot |
| [bug-triage](skills/bug-triage/SKILL.md) | coding | openbot |
| [interface-critique](skills/interface-critique/SKILL.md) | design | openbot |
| [evidence-brief ★](skills/evidence-brief/SKILL.md) | research | openbot |
| [competitor-comparison](skills/competitor-comparison/SKILL.md) | research | openbot |
| [launch-notes ★](skills/launch-notes/SKILL.md) | documents | openbot |
| [meeting-actions ★](skills/meeting-actions/SKILL.md) | productivity | openbot |
| [project-plan](skills/project-plan/SKILL.md) | productivity | openbot |
| [support-reply](skills/support-reply/SKILL.md) | documents | openbot |
| [account-brief](skills/account-brief/SKILL.md) | research | openbot |
| [outreach-draft](skills/outreach-draft/SKILL.md) | documents | openbot |
| [campaign-analysis](skills/campaign-analysis/SKILL.md) | data-analytics | openbot |
| [data-quality-review](skills/data-quality-review/SKILL.md) | data-analytics | openbot |
| [workflow-playbook](skills/workflow-playbook/SKILL.md) | automation | openbot |
| [hiring-scorecard](skills/hiring-scorecard/SKILL.md) | other | openbot |
| [acceptance-check](skills/acceptance-check/SKILL.md) | coding | openbot |
| [pr-follow-up](skills/pr-follow-up/SKILL.md) | coding | openbot |
| [api-skill-builder](skills/api-skill-builder/SKILL.md) | automation | openbot |
| [prototype-build](skills/prototype-build/SKILL.md) | design | openbot |
| [alt-text](skills/alt-text/SKILL.md) | design | openbot |
| [accessibility-audit](skills/accessibility-audit/SKILL.md) | design | openbot |
| [build-spec](skills/build-spec/SKILL.md) | design | openbot |
| [voice-edit](skills/voice-edit/SKILL.md) | documents | openbot |
| [search-content-brief](skills/search-content-brief/SKILL.md) | documents | openbot |
| [call-scorecard](skills/call-scorecard/SKILL.md) | other | openbot |
| [daily-brief](skills/daily-brief/SKILL.md) | productivity | openbot |
| [spend-audit](skills/spend-audit/SKILL.md) | data-analytics | openbot |
| [request-scoring](skills/request-scoring/SKILL.md) | automation | openbot |
| [care-log](skills/care-log/SKILL.md) | other | openbot |
| [recurring-charges](skills/recurring-charges/SKILL.md) | other | openbot |
| [agent-designer](skills/agent-designer/SKILL.md) | automation | openbot |
| [eggbot-getting-started](skills/eggbot-getting-started/SKILL.md) | automation | openbot |
| [routine-healthcheck](skills/routine-healthcheck/SKILL.md) | automation | openbot |
| [agent-chat-healthcheck](skills/agent-chat-healthcheck/SKILL.md) | automation | openbot |
| [working-with-teammate-agents](skills/working-with-teammate-agents/SKILL.md) | automation | openbot |
| `pstack`, with the 52 skills `pstack-<name>` of [bundles/pstack/skills](bundles/pstack/skills) | coding | cursor |

★ Featured on first publication. Existing Featured settings are preserved on reruns.

## Attribution

The 35 original OpenBot team Skills use the repository PolyForm Noncommercial 1.0.0 license. The five existing adapted Skills retain their pinned OpenAI or Anthropic source attribution and Apache-2.0 license. Each generated bundle contains the applicable LICENSE.txt and NOTICE.txt; the build also produces UPSTREAM_NOTICES.md.

`bundles/pstack/` is an unchanged copy of the `skills/` and `agents/` of the pstack plugin by Lauren Tan from the pinned `cursor/plugins` commit, under the MIT License. It is a pack in `catalog.json`: the build publishes it as the one Skill `pstack`. Its archive holds an index `SKILL.md`, the `LICENSE`, a `NOTICE.md`, and each folder of `skills/` as `skills/pstack-<folder>/`. The app installs each of those as a skill folder of its own, beside `pstack`, under one lock entry: one download and one install receipt. In Markdown, the build renames links, `/<name>` commands and `<name>` mentions of other pstack skills to `pstack-<name>`, removes `disable-model-invocation` so `$pstack-<name>` works with every provider, copies `agents/` into each skill that names a subagent, and adds a closing `pstack in OpenBot` section. Links to files that no skill installs go to the pinned commit. To update it, copy the new upstream `skills/` and `agents/`, update the pinned commit in `catalog.json` and `NOTICE.md`, and increase `catalogVersion`.
