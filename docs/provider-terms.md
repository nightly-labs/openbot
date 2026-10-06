# Provider terms

OpenBot does not sell, resell or pay for model usage. Each provider CLI signs in with your own
account or key, and your agreement with that provider applies to all usage. OpenBot does not check
that your use agrees with a provider's terms. A provider can limit or close an account that breaks
its terms. Read the terms of each provider that you use.

This page is not legal advice. It describes how OpenBot starts each provider and what the provider
publishes. Where the terms are not clear, this page tells you the lower-risk option.

## Claude

### How OpenBot runs Claude

- OpenBot uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview)
  (`@anthropic-ai/claude-agent-sdk`). The SDK starts the Claude Code CLI (`claude`) as a child
  process, and the CLI sends all requests to Anthropic.
- OpenBot downloads the `claude` executable from the npm package that Anthropic publishes for the
  SDK on your platform (`@anthropic-ai/claude-agent-sdk-<platform>`). OpenBot checks it against the
  npm `dist.integrity` hash and does not change it. If you installed `claude` yourself, or set
  `OPENBOT_CLAUDE_PATH`, OpenBot runs that executable. OpenBot turns off the CLI's own updater only
  for the copy that OpenBot downloads, because OpenBot updates that copy.
- Connect on the Claude row runs `claude auth login --claudeai`. The CLI opens Anthropic's sign-in
  page in your browser and stores the result. OpenBot does not read, copy or store the Claude
  credentials in `~/.claude` or the macOS Keychain. It runs `claude auth status` to show whether
  Claude is ready. You can also run `claude auth login` in a terminal.
- OpenBot names itself to the CLI with the `CLAUDE_AGENT_SDK_CLIENT_APP` variable.
- On a Linux host with no browser, a host admin can sign in Claude from another computer. The host
  runs `claude auth login --claudeai`, the admin opens Anthropic's sign-in page, and OpenBot sends the code
  that the page shows to the CLI on the host. See [hosted servers](hosted-servers.md).
- Team members can send messages to the Claude agents on your computer or host. These turns use
  your Claude sign-in, not the team member's sign-in.

### What Anthropic says

Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance)
(read on 2026-10-06) says:

- "OAuth authentication is intended exclusively for purchasers of Claude Free, Pro, Max, Team, and
  Enterprise subscription plans and is designed to support ordinary use of Claude Code and other
  native Anthropic applications."
- "Developers building products or services that interact with Claude's capabilities, including
  those using the Agent SDK, should use API key authentication through Claude Console or a
  supported cloud provider. Anthropic does not permit third-party developers to offer Claude.ai
  login into their own applications, or to route requests through Free, Pro, or Max plan
  credentials on behalf of their users."
- "developers may not collect, store, or intermediate Claude.ai credentials or session tokens —
  sign-in to a Claude account must complete through Anthropic's own flow."
- This does not "prevent an end user from signing in to the unmodified Claude Code binary with their
  own Claude subscription, including where a platform hosts Claude Code".
- "Advertised usage limits for Pro and Max plans assume ordinary, individual usage of Claude Code
  and the Agent SDK."
- "Anthropic reserves the right to take measures to enforce these restrictions and may do so without
  prior notice."

Anthropic has not confirmed to the OpenBot project that subscription sign-in through OpenBot is
permitted. For a decision about your use case, Anthropic tells you to
[contact sales](https://www.anthropic.com/contact-sales).

### Risk by use

| Use | Sign-in | Risk |
| --- | --- | --- |
| You use OpenBot on your own computer | Your Claude subscription, signed in with Connect or `claude auth login` | Not clear. You sign in to the unmodified CLI through Anthropic's flow, which Anthropic permits. But OpenBot is a third-party product built on the Agent SDK, and Anthropic tells such products to use API keys and not to offer Claude.ai login. Connect starts that login from OpenBot; `claude auth login` in a terminal does not. Persistent agents that run without you can go past "ordinary, individual usage". |
| A host that you sign in from another computer | Your Claude subscription, with the code sign-in | Higher. OpenBot sends the sign-in code from your browser to the host, and Anthropic can read that as a third party that offers Claude login or intermediates credentials. |
| Team members use Claude agents on your host | The host owner's Claude subscription | High. Other people's requests use one person's plan, which Anthropic does not permit. |
| Any of the above | An Anthropic API key, Amazon Bedrock, Google Cloud's Agent Platform or Microsoft Foundry | Low. This is the method that Anthropic tells Agent SDK products to use. Usage is billed to the key owner. Do not resell it. |

Use an API key or a cloud provider for a host, a team or agents that run without you. If you use a
subscription, use it only for your own work on your own computer, and accept that Anthropic can
limit the account.

### Use an API key

The Claude CLI reads its credentials in the order that Anthropic's
[authentication page](https://code.claude.com/docs/en/authentication#authentication-precedence)
gives. An API key comes before a subscription sign-in. OpenBot passes its environment to the CLI, so
use one of these:

- Set `ANTHROPIC_API_KEY` to a key from the [Claude Console](https://platform.claude.com) in the
  environment that starts OpenBot.
- Add the key to the `env` block, or an `apiKeyHelper` script, in `~/.claude/settings.json`.
- For Amazon Bedrock, Google Cloud's Agent Platform or Microsoft Foundry, set the variables in
  Anthropic's [third-party integrations](https://code.claude.com/docs/en/third-party-integrations)
  page.

Restart OpenBot. `claude auth status --json` then shows `"authMethod": "api_key"`, and OpenBot
shows Claude as ready. Run `claude auth logout` if you also want to remove the subscription sign-in.

## Other providers

The same rule applies: OpenBot runs each provider's CLI with your own sign-in or key, and that
provider's terms apply. Before you use a subscription plan, read what the provider says about
subscriptions in third-party tools. If you are not sure, use the provider's API key.
