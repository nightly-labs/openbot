# OpenBot team launch catalog

Version v2 contains 20 Skills and 15 Agents. Four Skills and four Agents are featured on first publication. All entries use the publisher **OpenBot Team**, start with zero installs, and include no scheduled routines. They work from supplied material and available tools; they do not assume a connected inbox, CRM, ad account, or phone service.

## Review locally

```sh
bun run api:migrate:local
bun run marketplace:seed:local
bun run dev --isolated
```

Reuse the dev app if it is already running. Open Marketplace and search **OpenBot Team** in Skills or Agents. Local seeding adds approved catalog records to this worktree's local account database and bundles to its local preview bucket. It does not reset the Electron profile, erase other listings, or create local Agents. Install an Agent from Marketplace to use it.

## Prepare and publish

```sh
bun run marketplace:build
bun run marketplace:publish:production
```

The build writes deterministic ZIP bundles, manifests, notices, and checksums to `out/marketplace-production/v2`. The publish command without flags is an offline dry run. Review the catalog and ensure the account database has migrations through `0019_marketplace_presentation.sql` before production publication.

To publish after review, authenticate Wrangler for the production account and provide `SKILLS_ADMIN_TOKEN` through the environment, then run:

```sh
bun run marketplace:publish:production -- --apply --confirm-production
```

The publisher verifies the production admin credential before writing, uploads immutable bundle keys, then inserts approved Skills and Agents with their exact skill-version dependencies. It does not go through community submission limits or pending review. `--local --apply` targets only local storage; mixing local and production flags is rejected.

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

★ Featured on first publication. Existing Featured settings are preserved on reruns.

## Attribution

The 15 original OpenBot team Skills use the repository PolyForm Noncommercial 1.0.0 license. The five existing adapted Skills retain their pinned OpenAI or Anthropic source attribution and Apache-2.0 license. Each generated bundle contains the applicable LICENSE.txt and NOTICE.txt; the build also produces UPSTREAM_NOTICES.md.
