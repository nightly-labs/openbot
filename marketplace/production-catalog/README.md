# OpenBot team launch catalog

Version v3 contains 27 Skills and 17 Agents. The `pstack` Skill installs 52 skills `pstack-<name>` with it. Four Skills and four Agents are featured on first publication. All entries show the public OpenBot logo as their creator badge, use the publisher **OpenBot**, and start with zero installs. Only Dr. Eggbot includes routines: two healthchecks that install paused, `transcript-healthcheck` (weekdays 08:44) and `routine-healthcheck` (Mondays 08:49), in the installer's timezone. An Agent's `routines` in `catalog.json` use the Marketplace routine shape, and the build checks them as the account service does. They work from supplied material and available tools; they do not assume a connected inbox, CRM, ad account, or phone service. The `pstack` Skill is the exception: it is the upstream text, unchanged in substance, and some of its skills use MCP servers, connectors or web links when the agent has them.

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

The build writes deterministic ZIP bundles, one SVG icon per Skill, manifests, notices, and checksums to `out/marketplace-production/v3`. A Skill icon is the artwork of its category, so a listing reads as a set; the mark uses paths, not emoji, because a reader's computer may not carry the font. The publish command without flags is an offline dry run. Review the catalog and ensure the account database has migrations through `0019_marketplace_presentation.sql` before production publication.

To publish after review, authenticate Wrangler for the production account and provide `SKILLS_ADMIN_TOKEN` through the environment, then run:

```sh
bun run marketplace:publish:production -- --apply --confirm-production
```

The publisher verifies the production admin credential before writing, uploads immutable bundle and icon keys, then inserts approved Skills and Agents with their exact skill-version dependencies. It does not go through community submission limits or pending review. `--local --apply` targets only local storage; mixing local and production flags is rejected.

## Repeating and updating

Stable IDs prevent duplicate listings. Repeating the same version preserves install counts and any existing Featured choice. A seed for an older version cannot move an approved listing back from a newer version. Existing bundle versions remain available to installed Agents.

After a version has been seeded or published, increase `catalogVersion` before changing its content. Content hashes are part of immutable version IDs; changing content while reusing a numeric version intentionally fails the database uniqueness constraint. Each Agent snapshot pins its Skill versions. Existing local installations update only through the normal Marketplace update action.

Do not use the separate `skills:seed`, `agents:seed`, or `dev:seed` demo scripts to populate production. They serve development fixtures, not this launch catalog.

## Agents

| Agent | Category | Focus |
| --- | --- | --- |
| Application Security Reviewer | coding | Finds concrete risks and builds actionable threat models |
| Product Design Lead | design | Turns product intent into distinctive, usable interfaces |
| Communications Partner | documents | Makes important writing clear, useful, and decision-ready |
| Code Review Partner ★ | coding | Finds actionable bugs before changes ship |
| Debugging Partner | coding | Turns a bug report into a verified fix path |
| Research Analyst ★ | research | Builds cited briefs and useful comparisons |
| Launch Coordinator ★ | productivity | Turns release scope into clear launch work |
| Project Partner ★ | productivity | Makes scope, dependencies, and next steps clear |
| Meeting Assistant | productivity | Captures decisions and follows through on commitments |
| Customer Support Partner | documents | Drafts clear replies and complete escalations |
| Account Research Partner | research | Prepares evidence for better discovery calls |
| Outreach Writer | documents | Writes relevant outreach without invented personalization |
| Campaign Analyst | data-analytics | Explains performance and designs the next experiment |
| Operations Planner | automation | Turns repeatable work into reliable playbooks |
| Hiring Partner | other | Builds structured interviews around job evidence |
| Dr. Eggbot | automation | Designs focused agents, skills and routines; installs with `pstack` |
| Error Reporter | coding | Finds what went wrong and writes a shareable report without secrets |

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
| [agent-designer](skills/agent-designer/SKILL.md) | automation | openbot |
| [eggbot-getting-started](skills/eggbot-getting-started/SKILL.md) | automation | openbot |
| [routine-healthcheck](skills/routine-healthcheck/SKILL.md) | automation | openbot |
| [agent-chat-healthcheck](skills/agent-chat-healthcheck/SKILL.md) | automation | openbot |
| [working-with-teammate-agents](skills/working-with-teammate-agents/SKILL.md) | automation | openbot |
| [error-report](skills/error-report/SKILL.md) | coding | openbot |
| `pstack`, with the 52 skills `pstack-<name>` of [bundles/pstack/skills](bundles/pstack/skills) | coding | cursor |

★ Featured on first publication. Existing Featured settings are preserved on reruns.

## Attribution

The 21 original OpenBot team Skills use the repository PolyForm Noncommercial 1.0.0 license. The five existing adapted Skills retain their pinned OpenAI or Anthropic source attribution and Apache-2.0 license. Each generated bundle contains the applicable LICENSE.txt and NOTICE.txt; the build also produces UPSTREAM_NOTICES.md.

`bundles/pstack/` is an unchanged copy of the `skills/` and `agents/` of the pstack plugin by Lauren Tan from the pinned `cursor/plugins` commit, under the MIT License. It is a pack in `catalog.json`: the build publishes it as the one Skill `pstack`. Its archive holds an index `SKILL.md`, the `LICENSE`, a `NOTICE.md`, and each folder of `skills/` as `skills/pstack-<folder>/`. The app installs each of those as a skill folder of its own, beside `pstack`, under one lock entry: one download and one install receipt. In Markdown, the build renames links, `/<name>` commands and `<name>` mentions of other pstack skills to `pstack-<name>`, removes `disable-model-invocation` so `$pstack-<name>` works with every provider, copies `agents/` into each skill that names a subagent, and adds a closing `pstack in OpenBot` section. Links to files that no skill installs go to the pinned commit. To update it, copy the new upstream `skills/` and `agents/`, update the pinned commit in `catalog.json` and `NOTICE.md`, and increase `catalogVersion`.
