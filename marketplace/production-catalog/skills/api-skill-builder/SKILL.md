---
name: "API Skill Builder"
description: "Turn an API or a repeated workflow into a tested local OpenBot skill. Read the docs, sample one real response first, keep keys out of files, write the smallest SKILL.md and a script only when needed, test it, then register it. Use when the user repeats the same request against a service."
---

# API Skill Builder

## When to use

- The user repeats the same request to a service, or a workflow that the agent does by hand.
- Not for a one-time request. Do it directly and do not make a skill.

## Inputs

1. **The job.** One sentence: the request the user repeats, its inputs, and the result they want. If it is
   not clear, ask one question with `ask_user`.
2. **The docs.** Open them with `openbot_browser` (call `openbot_browser.list_tabs` first), or ask the user to
   paste the relevant page. You need: the base address, the auth method, the one or two endpoints for the
   job, paging, and rate limits.
3. **The key.** If the API needs a key or token, check whether one is already saved with `list_api_keys`. If not, call
   `request_api_key` with the variable name that the script reads, such as `WEATHER_API_KEY`. Never ask for a
   key in chat. If the user pastes one, ask again with `request_api_key` and do not repeat the value.

## Steps

1. Call `list_local_skills`. If a skill for this job exists, read it with `read_local_skill` and revise it.
2. **Data shape first.** Make ONE real read-only request with the smallest input. Read the key from its
   saved file in the same command: `curl -s -H "Authorization: Bearer $(cat '<path>')" ...`.
   Never print the key. Record the field names, types, and one example value per field. Remove personal data
   from the example. Do not call an endpoint that writes, sends or charges to get a sample.
3. Decide what the skill keeps: the inputs it takes, the fields it returns, and the output format.
4. Make a folder in your workspace, for example `skills/<slug>/`. Write `SKILL.md` with frontmatter `name`
   (80 characters or less) and `description` (500 or less). Optional: `example-prompt`. In the body: the
   outcome, the steps, the request and the fields, the error cases, and how to check the result.
5. Add a script in `scripts/` only when the steps are hard to repeat by hand: paging, signing, or parsing.
   Use what the computer already has (shell tools, Python or Node standard library). The script reads the
   key from an environment variable. No secrets, environment files, dependencies, symlinks or archives in
   the folder.
6. **Test.** Follow the skill on a representative request from the user. Compare the result with the
   sample. Test one failure: a bad input or a missing key must give a clear message, not a stack trace.
7. Register: `create_skill` with the workspace-relative folder path, or `revise_skill` with the skill ID,
   the `expectedRevision`, and the folder path. Report the returned ID and revision.

## Checks

Each check is PASS or FAIL. Register only when checks 1 to 4 pass.

1. **Shape known:** one real response was read, and the skill names the fields it uses.
2. **Key safe:** no key, token or password in any file, message, tool argument or memory. Search the folder
   for "token", "secret", "key=" and "Bearer" before you register.
3. **Smallest:** every section and script is used by the job. Nothing for jobs the user did not ask for.
4. **Tested:** the representative request and one failure case ran, with the output shown.
5. **Registered:** the tool returned an ID and a revision.

## Output

```
Skill: <name> — <ID>, revision <n>
Job: <one sentence>
Request: <method> <endpoint> — fields used: <list>
Key: <variable name> (saved with request_api_key) | none

Checks
1. Shape known — PASS — sampled <endpoint> at <time>
2. Key safe — PASS
3. Smallest — PASS — SKILL.md, scripts/<file>
4. Tested — PASS — "<request>" → <result summary>; bad input → "<message>"
5. Registered — PASS

Installed on: this agent only
```

## Approvals and stop conditions

- Creating a skill does not allow publishing, sharing or sending. Ask the user before you publish it,
  share it, or install it on another agent.
- Do not call endpoints that write, send, delete or spend money without the user's yes, also in tests.
- Stop if the API terms forbid the use, or the docs require a paid plan the user has not confirmed.
- Ask before you write a key into an environment file.

## Common failures

- Writing the skill from the docs alone. The real response often differs.
- A key in the script, the example, or the chat.
- A large script for a job that two documented requests can do.
- Registering a skill that never ran on a real request.
