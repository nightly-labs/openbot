# Provider terms

OpenBot does not sell, resell or pay for model usage. Each provider CLI signs in with your own
account or key, and your agreement with that provider applies to all usage. OpenBot does not check
that your use agrees with a provider's terms, and a provider can limit or close an account that
breaks them.

This page is not legal advice. It tells how OpenBot starts a provider and what the provider
publishes.

## Claude

### How OpenBot runs Claude

- OpenBot uses the [Claude Agent SDK](https://code.claude.com/docs/en/agent-sdk/overview). The SDK
  starts the Claude Code CLI (`claude`), and the CLI sends all requests to Anthropic.
- OpenBot downloads `claude` from Anthropic's npm package for your platform
  (`@anthropic-ai/claude-agent-sdk-<platform>`), checks the npm `dist.integrity` hash, and does not
  change the executable. It turns off the CLI's own updater for that copy only. If you set
  `OPENBOT_CLAUDE_PATH`, or installed `claude` yourself, OpenBot runs that executable.
- Connect on the Claude row runs `claude auth login --claudeai`, which opens Anthropic's sign-in page
  in your browser. You can also run `claude auth login` in a terminal. The CLI stores the
  credentials; OpenBot does not read, copy or store them. OpenBot runs `claude auth status` to show
  whether Claude is ready.
- On a Linux host with no browser, a host admin can sign in Claude from another computer: the host
  runs `claude auth login --claudeai`, and OpenBot sends the code that Anthropic's page shows to the
  CLI on the host. See [hosted servers](hosted-servers.md).
- Team members can send messages to the Claude agents on your computer or host. These turns use your
  Claude sign-in.

### What Anthropic says

Anthropic's [legal and compliance page](https://code.claude.com/docs/en/legal-and-compliance), read on
2026-10-06:

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
permitted. For your own use case, Anthropic tells you to
[contact sales](https://www.anthropic.com/contact-sales).

### Risk by use

| Use | Risk with a Claude subscription |
| --- | --- |
| Your own work on your own computer | Not clear. You sign in to the unmodified CLI on Anthropic's page, which Anthropic permits. But OpenBot is an Agent SDK product, and Connect starts the Claude.ai login from OpenBot. Agents that run without you can go past "ordinary, individual usage". |
| Code sign-in on a host from another computer | Higher. OpenBot carries the sign-in code from your browser to the host. |
| Team members use Claude agents on your host | High. Other people's requests use one person's plan. |

An Anthropic API key, Amazon Bedrock, Google Cloud's Agent Platform or Microsoft Foundry is the
method that Anthropic tells Agent SDK products to use. The CLI uses it before a subscription sign-in
([precedence](https://code.claude.com/docs/en/authentication#authentication-precedence)), and
OpenBot passes its environment to the CLI. Set `ANTHROPIC_API_KEY` in the environment that starts
OpenBot, or in the `env` block of `~/.claude/settings.json`. For a cloud provider, see Anthropic's
[third-party integrations](https://code.claude.com/docs/en/third-party-integrations).

## Other providers

OpenBot runs each provider's CLI with your own sign-in or key, and that provider's terms apply.
Before you use a subscription plan, read what the provider says about third-party tools.
