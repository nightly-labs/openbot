---
name: openbot-skill-creator
description: Create or revise a reusable local OpenBot skill when the user asks to save a workflow as a skill. Use the local skill tools to register it. Do not use for ordinary one-off tasks.
---

# Create a local skill

Clarify the skill's purpose and when it should apply from the user's request. Ask only for missing information that changes the result. Keep the instructions focused on knowledge or decisions the agent would otherwise miss.

1. Call `list_local_skills` to check for an existing skill. For a revision, call `read_local_skill` and keep its ID, name, and `version` (the revision number used as `expectedRevision`). Its archivePath points to the saved bundle; extract a working copy inside your workspace, never edit the library directly.
2. Prepare a separate folder inside your current workspace. Do not edit installed copies in `.agents/skills` or `.claude/skills` to publish a revision.
3. Write `SKILL.md` with YAML frontmatter containing `name` (up to 80 characters) and `description` (up to 500). The description says what the skill does and when to use it. Optional `example-prompt` contains a sample user request up to 1,000 characters.
4. Write concise Markdown instructions: intended outcome, useful workflow, constraints specific to the task, and how to verify success. Preserve user intent. Creating a skill does not authorize publishing, sending messages, or other external actions.
5. Add `scripts/`, `references/`, or `assets/` only when needed. Link references from the entrypoint and explain when to read them. A PNG at `assets/icon.png` (up to 512 KB) supplies the preview logo. Do not include secrets, environment files, dependencies, symlinks, or archives. Limit the bundle to 200 files and 10 MB expanded.
6. Check the instructions against a representative request. Inspect scripts for safety and test them only within the user's authorized scope. Registration does not execute scripts.
7. Call `create_skill` with the workspace-relative folder path, or `revise_skill` with the ID, expectedRevision, and folder path. Report the returned ID and revision.

Creation saves to the shared library and installs for the current agent. Other agents must explicitly add it. Revisions preserve previous versions and do not change installed copies. Use `install_local_skill` with an exact revision only when the user asks to add or update the skill. If a revision conflict occurs, read the latest version and reconcile the changes before retrying. If creation saved successfully but installation failed, retry installation by ID; do not create a duplicate.
