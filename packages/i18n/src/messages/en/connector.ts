import { defineMessages } from "../../message";

export const messages = defineMessages("connector", {
  // Server settings > Connectors: the built-in GitHub connection of this computer.
  "connector.github.title": "GitHub",
  "connector.github.description":
    "Every agent on this computer can use your GitHub repositories, issues and pull requests, and gh and git.",
  "connector.github.connect": "Connect GitHub",
  "connector.github.pendingTitle": "Type this code on GitHub",
  "connector.github.pendingDescription": "GitHub opened in your browser. Type the code there to connect.",
  "connector.github.waiting": "Waiting for GitHub",
  "connector.github.copyCode": "Copy code",
  "connector.github.codeCopied": "Copied",
  "connector.github.openGitHub": "Open GitHub",
  "connector.github.cancel": "Cancel",
  "connector.github.connectedAs": "Connected as @{login}",
  "connector.github.repositoriesTitle": "Repositories",
  "connector.github.repositoriesDescription":
    "Agents can use only the repositories where the OpenBot GitHub App is installed.",
  "connector.github.chooseRepositories": "Choose repositories",
  "connector.github.repositoriesLoading": "Reading the repositories from GitHub",
  "connector.github.repositoriesFailed": "OpenBot could not read the repositories from GitHub.",
  "connector.github.noRepositories": "The OpenBot GitHub App is not installed on a repository yet.",
  // {count} is a number, such as 12.
  "connector.github.moreRepositories": {
    one: "And {count} more repository",
    other: "And {count} more repositories",
  },
  // A badge next to a repository that only its members can see.
  "connector.github.private": "Private",
  "connector.github.disconnect": "Disconnect",
  "connector.github.disconnectTitle": "Disconnect GitHub",
  "connector.github.disconnectSummary": "Every agent loses GitHub. Your chats and files stay.",
  "connector.github.expiredTitle": "The GitHub connection expired",
  "connector.github.expiredDescription": "Connect again as @{login} to give agents GitHub again.",
  "connector.github.reconnect": "Reconnect",
  "connector.github.actionFailed": "OpenBot could not change the GitHub connection.",
  // The status next to the name at the top of the GitHub page.
  "connector.github.statusConnected": "Connected",
  "connector.github.statusConnecting": "Connecting",
  "connector.github.statusExpired": "Expired",
  "connector.github.statusNotSetUp": "Not set up",
  "connector.github.accountTitle": "Account",
  // {count} is the number of repositories in the list, such as 12.
  "connector.github.filterPlaceholder": {
    one: "Filter {count} repository",
    other: "Filter {count} repositories",
  },
  "connector.github.filterLabel": "Filter repositories",
  // {query} is the text the user typed in the filter.
  "connector.github.noMatch": "No repository matches “{query}”.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.github.stepSignIn": "Sign in",
  "connector.github.stepConnected": "Connected",
  "connector.github.requestingCode": "OpenBot asks GitHub for a code.",
  // {code} is the code to type on GitHub, such as WDJB-MJHT.
  "connector.github.codeLabel": "Code {code}",
  "connector.github.failedTitle": "GitHub did not connect",
  "connector.github.cancelConnecting": "Cancel connecting GitHub",
  // {count} is the number of repositories that agents can use.
  "connector.github.connectedSummary": {
    one: "{count} repository · every agent on this computer",
    other: "{count} repositories · every agent on this computer",
  },
  "connector.github.done": "Done",
  "connector.github.later": "Later",
  // The confirmation before Disconnect. {login} is the GitHub account name, such as octocat.
  "connector.github.disconnectConfirmTitle": "Disconnect GitHub?",
  "connector.github.disconnectConfirmDescription": "Disconnect removes the sign-in of @{login} from this computer.",
  "connector.github.disconnectEffectTools": "Every agent loses the GitHub tools, gh and git.",
  "connector.github.disconnectEffectRevoke": "Then GitHub opens, where you can revoke OpenBot.",
  "connector.github.disconnectEffectKept": "Chats, files and agent memory stay on this computer.",
  "connector.github.keepConnected": "Keep connected",
  "connector.github.close": "Close",
  // The last section of an integration page, with the action that removes it.
  "connector.dangerZone": "Danger zone",

  // Server settings > Connectors: the list of integrations. Each row opens its page.
  "connector.hub.onThisComputer": "On this computer",
  "connector.hub.notSetUp": "Not set up",
  "connector.hub.available": "Available",
  // {name} is the name of an integration, such as Slack.
  "connector.hub.open": "Open {name}",
  "connector.hub.setUp": "Set up",
  "connector.hub.back": "All connectors",
  // {names} lists the agents, such as "Chief, Research".
  "connector.hub.usedBy": "Used by {names}",

  // Server settings > Connectors > Slack: a workspace installs the one OpenBot app, and the Slack
  // Orchestrator agent receives each request, asks the team and answers.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "People mention @OpenBot in Slack or send it a direct message. The Slack Orchestrator asks the right agent and answers.",
  "connector.slack.statusNotSetUp": "Not set up",
  "connector.slack.statusConnected": "Connected",
  "connector.slack.statusAttention": "Needs attention",
  // {workspace} is the Slack workspace name.
  "connector.slack.summaryConnected": "{workspace} · Slack Orchestrator answers",
  "connector.slack.summaryNoAgent": "{workspace} · No agent answers yet",
  "connector.slack.attentionTitle": {
    one: "{count} workspace needs attention",
    other: "{count} workspaces need attention",
  },
  "connector.slack.attentionDescription": "The status below says what to do.",
  "connector.slack.connect": "Connect Slack",
  "connector.slack.addAgent": "Add agent",
  "connector.slack.actionFailed": "Slack did not accept the change",
  "connector.slack.workspaceTitle": "Workspace",
  "connector.slack.workspaceDescription": "People mention @OpenBot or send it a direct message.",
  "connector.slack.disconnectWorkspace": "Disconnect",
  "connector.slack.missingScopes":
    "OpenBot does not have these permissions in Slack: {scopes}. Disconnect the workspace, then connect it again.",
  "connector.slack.retryAt": "Slack asked OpenBot to wait. It tries again at {time}.",
  "connector.slack.reconnect": "Reconnect",
  "connector.slack.resume": "Resume",
  // {action} is a button, such as Pause; {name} is the workspace name.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.orchestratorTitle": "Slack Orchestrator",
  "connector.slack.orchestratorDescription":
    "This agent receives every request from Slack. It answers short ones itself, gives other work to the right agent, and posts the answer in the thread.",
  "connector.slack.orchestratorNone": "No agent answers yet",
  "connector.slack.orchestratorNoneDescription": "Add the Slack Orchestrator, or Slack gets no answer.",
  "connector.slack.inviteNote":
    "OpenBot joins every public channel by itself, and each new one. For a private channel, invite it: /invite @OpenBot.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.slack.stepWorkspace": "Workspace",
  "connector.slack.stepAgent": "Agent",
  "connector.slack.connectTitle": "Connect a Slack workspace",
  "connector.slack.connectDescription":
    "OpenBot installs one app in the workspace, named OpenBot, and it joins every public channel.",
  "connector.slack.connectStepBrowser": "Slack opens in your browser",
  "connector.slack.connectStepAllow": "Select the workspace in the top-right corner, then Allow",
  "connector.slack.connectStepReturn": "This dialog continues when Slack is done",
  "connector.slack.connectInSlack": "Connect in Slack",
  "connector.slack.connectWaiting": "Waiting for Slack. Finish the install in your browser.",
  "connector.slack.agentStepTitle": "Add the Slack Orchestrator",
  // {workspace} is the Slack workspace name.
  "connector.slack.agentStepDescription":
    "This new agent answers everything that people send to @OpenBot in {workspace}.",
  "connector.slack.orchestratorName": "Slack Orchestrator",
  "connector.slack.orchestratorRole": "Answers in Slack and asks the team",
  "connector.slack.orchestratorDoesReceive": "Receives every Slack request first",
  "connector.slack.orchestratorDoesDelegate": "Gives each task to the agent that fits best",
  "connector.slack.orchestratorDoesAnswer": "Posts the answer in the Slack thread",
  "connector.slack.orchestratorModel": "Model",
  "connector.slack.doneTitle": "OpenBot is in {workspace}",
  "connector.slack.doneDescription": "Mention @OpenBot in any public channel, or send it a direct message.",
  "connector.slack.done": "Done",
  "connector.slack.disconnectTitle": "Disconnect {workspace}?",
  "connector.slack.disconnectDescription":
    "OpenBot stops answering in {workspace} and removes its Slack token from this computer.",
  "connector.slack.disconnectEffect": "People in {workspace} can no longer reach your agents through @OpenBot.",
  "connector.slack.removeEffectKept": "The conversations and the Slack Orchestrator stay in OpenBot.",
  "connector.slack.keep": "Keep connected",
  "connector.slack.close": "Close",

  // Server settings > Connectors > Discord: a Discord server (a guild) adds the one OpenBot bot, and
  // the Discord Orchestrator agent receives each request, asks the team and answers. Always write
  // "Discord server": "server" alone is an OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "People mention @OpenBot in a channel of a Discord server. The Discord Orchestrator asks the right agent and answers.",
  "connector.discord.statusNotSetUp": "Not set up",
  "connector.discord.statusConnected": "Connected",
  "connector.discord.statusAttention": "Needs attention",
  // {workspace} is the Discord server name.
  "connector.discord.summaryConnected": "{workspace} · Discord Orchestrator answers",
  "connector.discord.summaryNoAgent": "{workspace} · No agent answers yet",
  "connector.discord.attentionTitle": {
    one: "{count} Discord server needs attention",
    other: "{count} Discord servers need attention",
  },
  "connector.discord.attentionDescription": "The status below says what to do.",
  "connector.discord.connect": "Connect Discord",
  "connector.discord.addAgent": "Add agent",
  "connector.discord.actionFailed": "Discord did not accept the change",
  "connector.discord.workspaceTitle": "Discord server",
  "connector.discord.workspaceDescription": "Mention @OpenBot in a channel. Reply to OpenBot to continue.",
  "connector.discord.disconnectWorkspace": "Disconnect",
  "connector.discord.missingScopes":
    "OpenBot does not have these permissions in Discord: {scopes}. Disconnect the Discord server, then connect it again.",
  "connector.discord.retryAt": "Discord asked OpenBot to wait. It tries again at {time}.",
  "connector.discord.reconnect": "Reconnect",
  "connector.discord.resume": "Resume",
  // {action} is a button, such as Pause; {name} is the Discord server name.
  "connector.discord.rowAction": "{action}: {name}",
  "connector.discord.orchestratorTitle": "Discord Orchestrator",
  "connector.discord.orchestratorDescription":
    "This agent receives every request from Discord. It answers short ones itself, gives other work to the right agent, and replies with the answer in the channel.",
  "connector.discord.orchestratorNone": "No agent answers yet",
  "connector.discord.orchestratorNoneDescription": "Add the Discord Orchestrator, or Discord gets no answer.",
  "connector.discord.channelsNote": "OpenBot sees the channels that its role can view.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.discord.stepWorkspace": "Discord server",
  "connector.discord.stepAgent": "Agent",
  "connector.discord.connectTitle": "Connect a Discord server",
  "connector.discord.connectDescription": "OpenBot adds one bot, named OpenBot, to the Discord server.",
  "connector.discord.connectStepBrowser": "Discord opens in your browser",
  "connector.discord.connectStepAllow": "Select the server, then Authorize",
  "connector.discord.connectStepReturn": "This dialog continues when Discord is done",
  "connector.discord.connectInDiscord": "Connect in Discord",
  "connector.discord.connectWaiting": "Waiting for Discord. Finish the authorization in your browser.",
  "connector.discord.agentStepTitle": "Add the Discord Orchestrator",
  // {workspace} is the Discord server name.
  "connector.discord.agentStepDescription":
    "This new agent answers everything that people send to @OpenBot in {workspace}.",
  "connector.discord.orchestratorName": "Discord Orchestrator",
  "connector.discord.orchestratorRole": "Answers in Discord and asks the team",
  "connector.discord.orchestratorDoesReceive": "Receives every Discord request first",
  "connector.discord.orchestratorDoesDelegate": "Gives each task to the agent that fits best",
  "connector.discord.orchestratorDoesAnswer": "Replies with the answer in the Discord channel",
  "connector.discord.orchestratorModel": "Model",
  "connector.discord.doneTitle": "OpenBot is in {workspace}",
  "connector.discord.doneDescription": "Mention @OpenBot in a channel. Reply to OpenBot to continue.",
  "connector.discord.done": "Done",
  "connector.discord.disconnectTitle": "Disconnect {workspace}?",
  "connector.discord.disconnectDescription":
    "OpenBot stops answering in {workspace} and removes the Discord connection from this computer.",
  "connector.discord.disconnectEffect": "People in {workspace} can no longer reach your agents through @OpenBot.",
  "connector.discord.removeEffectKept": "The conversations and the Discord Orchestrator stay in OpenBot.",
  "connector.discord.keep": "Keep connected",
  "connector.discord.close": "Close",
  // Marketplace > 1Password: a vault that the user shares with OpenBot through a service account.
  "connector.onePassword.title": "1Password",
  "connector.onePassword.description":
    "Share a dedicated 1Password vault with OpenBot through a service account, so agents can sign in to sites in the OpenBot browser.",
  "connector.onePassword.howItWorks":
    "Connecting sets up a “Shared with OpenBot” vault in your 1Password account and a service account that can read only that vault. OpenBot fills saved logins in its browser on this computer, so only the items you move into that vault are ever shared. Agents never see a password.",
  "connector.onePassword.connect": "Connect 1Password",
  // The three setup steps before a connection, each with the one button it needs.
  "connector.onePassword.setupTitle": "Set up",
  "connector.onePassword.stepCliTitle": "Install the 1Password CLI",
  "connector.onePassword.stepCliChecking": "Looking for the 1Password CLI on this computer",
  "connector.onePassword.stepCliInstalling": "Downloading the 1Password CLI from 1Password",
  // {version} is a version number, such as 2.39.0.
  "connector.onePassword.stepCliReady": "Version {version} is installed.",
  "connector.onePassword.stepCliMissing":
    "OpenBot downloads it from 1Password into its own folder. It needs no administrator password.",
  "connector.onePassword.stepCliManual":
    "OpenBot cannot install it on this computer. Install it from 1Password, then come back to this page.",
  "connector.onePassword.installCli": "Install",
  "connector.onePassword.stepAppTitle": "Turn on the CLI integration",
  "connector.onePassword.stepAppDescription":
    "In the 1Password app, open Settings > Developer and turn on “Integrate with 1Password CLI”.",
  "connector.onePassword.stepAppReady": "The 1Password app lets the CLI create the shared vault.",
  "connector.onePassword.openApp": "Open 1Password",
  "connector.onePassword.checkAgain": "Check again",
  "connector.onePassword.stepVaultTitle": "Create the shared vault",
  "connector.onePassword.stepVaultDescription":
    "OpenBot creates the vault “Shared with OpenBot” and a service account that can only read it. 1Password asks you to approve.",
  "connector.onePassword.useToken": "Use a service account token instead",
  "connector.onePassword.tokenLabel": "Service account token",
  "connector.onePassword.tokenPlaceholder": "ops_…",
  "connector.onePassword.connectWithToken": "Connect",
  "connector.onePassword.approveInApp": "Approve the request in the 1Password app",
  "connector.onePassword.cancel": "Cancel",
  "connector.onePassword.chooseAccountTitle": "Choose an account",
  "connector.onePassword.chooseAccountDescription": "OpenBot creates the shared vault in the account you choose.",
  "connector.onePassword.useAccount": "Use this account",
  "connector.onePassword.vaultTitle": "Shared vault",
  "connector.onePassword.vaultDescription":
    "Move a login into this vault in 1Password to let agents sign in with it. Remove it to stop.",
  "connector.onePassword.loginsLoading": "Reading the logins from 1Password",
  // {count} is a number, such as 3.
  "connector.onePassword.loginCount": {
    one: "{count} login",
    other: "{count} logins",
  },
  "connector.onePassword.disconnect": "Disconnect",
  "connector.onePassword.disconnectTitle": "Disconnect 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot forgets the token. The vault and the service account stay in 1Password; remove them there if you no longer need them.",
  "connector.onePassword.actionFailed": "OpenBot could not change the 1Password connection.",
  "connector.onePassword.statusConnected": "Connected",
  "connector.onePassword.statusConnecting": "Connecting",
  "connector.onePassword.statusNotSetUp": "Not set up",
  "connector.bitwarden.title": "Bitwarden",
  "connector.bitwarden.description": "Fill browser logins from Bitwarden.",
  "connector.bitwarden.setup":
    "Install the Bitwarden CLI and sign in with bw login. Create a folder named Shared with OpenBot and put only the logins that agents may use in it. Run bw unlock --raw and paste the session key below. Do not paste your master password.",
  "connector.bitwarden.scope":
    "All agents on this computer can use matching logins in Shared with OpenBot. OpenBot uses exact HTTPS origins. It does not use items that require a master password prompt or a custom URI match rule.",
  "connector.bitwarden.session":
    "The session key stays in memory. Connect again after 8 hours without vault use or after OpenBot exits. Disconnect stops OpenBot access; it does not lock other Bitwarden clients.",
  "connector.bitwarden.sessionKey": "Bitwarden session key",
  "connector.bitwarden.connect": "Connect Bitwarden",
  "connector.bitwarden.disconnect": "Disconnect Bitwarden",
  "connector.bitwarden.connected": "Connected",
  "connector.bitwarden.disconnected": "Not connected",
  "connector.bitwarden.failed": "Could not connect to Bitwarden.",

  // Server settings > Connectors > Telegram
  "connector.telegram.title": "Telegram",
  "connector.telegram.description": "Send tasks to your OpenBot agents and get reports back via Telegram bot.",
  "connector.telegram.statusNotSetUp": "Not set up",
  "connector.telegram.statusConnected": "Connected",
  "connector.telegram.statusAttention": "Needs attention",
  "connector.telegram.summaryConnected": "{botUsername} · Active",
  "connector.telegram.summaryNoAgent": "{botUsername} · No agent assigned",
  "connector.telegram.attentionTitle": {
    one: "{count} connection needs attention",
    other: "{count} connections need attention",
  },
  "connector.telegram.attentionDescription": "The status below says what to do.",
  "connector.telegram.connect": "Connect Telegram",
  "connector.telegram.actionFailed": "Telegram did not accept the change",
  "connector.telegram.botTitle": "Bot",
  "connector.telegram.botDescription": "Direct messages and mentions in groups send tasks to OpenBot.",
  "connector.telegram.disconnect": "Disconnect",
  "connector.telegram.reconnect": "Reconnect",
  "connector.telegram.resume": "Resume",
  "connector.telegram.pause": "Pause",
  "connector.telegram.tokenLabel": "Bot Token",
  "connector.telegram.tokenPlaceholder": "123456789:ABCdefGhIJKlmNoPQRsTUVwxyZ",
  "connector.telegram.tokenHelp": "Create a bot with @BotFather on Telegram and paste the token here.",
  "connector.telegram.saveToken": "Connect Bot",
  "connector.telegram.agentTitle": "Assigned Agent",
  "connector.telegram.agentDescription": "This agent receives tasks sent to your Telegram bot.",
  "connector.telegram.agentSelect": "Select an agent",
  "connector.telegram.disconnectTitle": "Disconnect {bot}?",
  "connector.telegram.disconnectDescription":
    "OpenBot stops answering on Telegram and removes the bot token from this computer.",
  "connector.telegram.disconnectEffect": "You will no longer be able to reach your OpenBot agents via Telegram.",
  "connector.telegram.removeEffectKept": "Conversations and agents stay in OpenBot.",
  "connector.telegram.keep": "Keep connected",
  "connector.telegram.close": "Close",
  "connector.telegram.rowAction": "{action}: {name}",
});
