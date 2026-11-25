---
name: custom-server-plan
description: Show, set, change or remove the paid plan (the paywall) of a custom OpenBot server that runs already. Use when asked to make a customer pay for their custom or enterprise server, to add, change or remove the plan, price or paywall of such a server, or to see whether it pays.
---

# Custom server plan

A custom server can have one plan. The owner sees a paywall with that plan in the app and pays it in
Stripe Checkout. `scripts/hosting/leaseweb-pool.ts custom-plan` shows, sets, changes and removes it.
[The plan of a custom server](../../../docs/hosted-servers.md#the-plan-of-a-custom-server) is the
source for the command, its flags and what it does. This skill adds the rules for an agent. To set up
a new custom server, use [custom-server](../custom-server/SKILL.md): its `--plan` sets the plan at
the setup.

## Rules

- The repository is public. Do not write a customer name, an email, a price that the customer agreed
  to, or a server ID in a commit, a PR, an issue or a document.
- Never print a token. Load the environment as the docs say, with the root `.env.keys` of the main
  checkout: a worktree has none.
- `--apply` without `--env` changes production, and the owner sees the paywall at once. Show the
  dry run and get the developer's approval first.
- Never change a paid plan in D1. The command refuses it; change the subscription in Stripe.
- Do not run the command again and again while it refuses an open checkout. Tell the developer, and
  run it again after 35 minutes.

## Steps

1. Get the OpenBot server ID (`host_id` in D1, the last line of the `custom` command). It is not the
   VPS ID. Ask for it when it is missing.
2. Run `custom-plan <server ID>` with no other flag. Report the current plan and the subscription
   status.
3. For a change, get the plan name, the price, the currency and interval, the vCPU, memory and
   storage, and personalized support. Ask for each value that is missing; do not guess a price.
4. Run the change without `--apply`, and show its result to the developer.
5. After approval, run it again with `--apply`. Report the new plan and the number of members whose
   apps get the change.

## A test run

Use `--env=local` with the local D1 of `bun run dev:api` in this worktree, or `--env=test` with the
test D1. Neither changes production. Stripe Checkout uses the test keys of the dev environment.
