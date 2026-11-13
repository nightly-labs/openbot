---
name: custom-server
description: Set up a Leaseweb VPS as the OpenBot server of one customer (an enterprise or custom server), with the customer as the owner. Use when asked to set up, assign or give a VPS or a dedicated server to a customer or an email, to find a Leaseweb VPS that was just bought, or to continue a custom server setup that stopped.
---

# Custom server

A custom server is a Leaseweb VPS that runs OpenBot for one customer. It is not in the hosted pool,
and the Worker does not manage it. `scripts/hosting/leaseweb-pool.ts custom` does all the steps.
[Leaseweb VPS](../../../docs/hosted-servers.md#leaseweb-vps) is the source for the commands and what
they do. This skill adds the rules for an agent.

## Rules

- The customer is the owner. The server signs in with a server claim for the customer's email, which
  the command makes. Never sign the server in to an operator account, and never invite the customer
  to a server that an operator owns.
- Take only a VPS with no reference. Never take a VPS with a reference, also `pool-free`. The
  command refuses both.
- The repository is public. Do not write a customer name, an email, an address or a VPS ID in a
  commit, a PR, an issue or a document. Keys files and logs go in `.openbot-build/custom/`, which git
  ignores.
- Never print a token or a password. Load the environment as the docs say, with the root `.env.keys`
  of the main checkout: a worktree has none.
- `--apply` changes production. Show the plan of the dry run and get the developer's approval first.

## Steps

1. Get the four inputs: the VPS ID, the owner's email, one word for the customer (`a-z`, `0-9`) and
   the server name that the customer sees (6 to 32 characters). Ask for each one that is missing.
   When the developer does not know the VPS ID, run `leaseweb-pool.ts free`: it lists each VPS with no
   reference on the four accounts.
2. Write the operator keys to `.openbot-build/custom/operator-keys`, as the docs say.
3. Run the command without `--apply`. Show the plan: the reference, the hostname and the server
   name. Do not show the email in a message that other people can read.
4. After approval, run it with `--apply`, and write the output to
   `.openbot-build/custom/run-<VPS ID>.log`.
5. When it stops, read the error and run the same command again. It continues from the step where it
   stopped. Known causes, both temporary:
   - A Leaseweb API call times out.
   - The bootstrap check "SSH offers keys only" fails with `exit 255`, because the server closed one
     SSH connection before the greeting.

   Stop and tell the developer when the command says that another account is signed in.
6. Report the reference, the OpenBot version, and the result of the online check and of the D1
   owner check. The owner signs in to the app with that email, sees the server, and invites the
   other members.

## A test run

Use your own email as the owner. After the test, ask the developer before you erase the VPS. Then,
in this order:

1. Remove the server from your account: `DELETE /v2/remote/hosts/<host ID>/` with your session. The
   host ID is the server ID in the last line of the command.
2. Reinstall the VPS: `PUT /publicCloud/v1/vps/<VPS ID>/reinstall` with the image of
   `leaseweb-pool.ts`. This erases the disk.
3. Clear the reference: `PUT /publicCloud/v1/vps/<VPS ID>` with `{"reference": ""}`.
