import { defineMessages } from "../../message";

export const messages = defineMessages("connector", {
  // Marketplace > Apps > GitHub: the built-in GitHub connection.
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
  "connector.github.moreRepositories": { one: "And {count} more repository", other: "And {count} more repositories" },
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
  "connector.github.accountTitle": "Account",
  // {count} is the number of repositories in the list, such as 12.
  "connector.github.filterPlaceholder": { one: "Filter {count} repository", other: "Filter {count} repositories" },
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
  // The same text for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.github.descriptionHost":
    "Every agent on {host} can use your GitHub repositories, issues and pull requests, and gh and git.",
  "connector.github.connectedSummaryHost": {
    one: "{count} repository · every agent on {host}",
    other: "{count} repositories · every agent on {host}",
  },
  "connector.github.disconnectConfirmDescriptionHost": "Disconnect removes the sign-in of @{login} from {host}.",
  "connector.github.disconnectEffectKeptHost": "Chats, files and agent memory stay on {host}.",
  "connector.github.keepConnected": "Keep connected",
  "connector.github.close": "Close",
  // The last section of an integration page, with the action that removes it.
  "connector.dangerZone": "Danger zone",
  "connector.statusUnknown": "Unknown",
  "connector.readFailed": "OpenBot could not read the state of this connection.",

  // Marketplace > Apps > Slack: a workspace installs the one OpenBot app, and the Slack
  // Orchestrator agent receives each request, asks the team and answers.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "People mention @OpenBot in Slack or send it a direct message. The Slack Orchestrator asks the right agent and answers.",
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
  "connector.slack.workspaceTitle": "Workspaces",
  "connector.slack.workspaceDescription": "People mention @OpenBot or send it a direct message.",
  "connector.slack.disconnectWorkspace": "Disconnect",
  "connector.slack.disconnectAllTitle": "Disconnect Slack",
  "connector.slack.disconnectAllSummary":
    "Every workspace disconnects. People can no longer reach your agents through @OpenBot.",
  "connector.slack.disconnectAllSummaryOrchestrator":
    "Every workspace disconnects. The Slack Orchestrator and its conversations are deleted from OpenBot.",
  "connector.slack.missingScopes":
    "OpenBot does not have these permissions in Slack: {scopes}. Disconnect the workspace, then connect it again.",
  "connector.slack.retryAt": "Slack asked OpenBot to wait. It tries again at {time}.",
  "connector.slack.reconnect": "Reconnect",
  "connector.slack.pause": "Pause",
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
  "connector.slack.disconnectDescriptionHost":
    "OpenBot stops answering in {workspace} and removes its Slack token from {host}.",
  "connector.slack.disconnectEffect": "People in {workspace} can no longer reach your agents through @OpenBot.",
  "connector.slack.removeEffectKept": "The conversations and the Slack Orchestrator stay in OpenBot.",
  "connector.slack.removeEffectDeleted": "The Slack Orchestrator and its conversations are deleted from OpenBot.",
  "connector.slack.keep": "Keep connected",
  "connector.slack.close": "Close",
  "connector.slack.addWorkspace": "Add workspace",
  // Shown when the page has the maximum number of workspaces.
  "connector.slack.limitReached": {
    one: "You can connect a maximum of {count} workspace.",
    other: "You can connect a maximum of {count} workspaces.",
  },
  // {count} is the number of Slack workspaces: two or more.
  "connector.slack.summaryMany": {
    one: "{count} workspace · Slack Orchestrator answers",
    other: "{count} workspaces · Slack Orchestrator answers",
  },

  // Marketplace > Apps > Discord: a Discord server (a guild) adds the one OpenBot bot, and
  // the Discord Orchestrator agent receives each request, asks the team and answers. Always write
  // "Discord server": "server" alone is an OpenBot server.
  "connector.discord.title": "Discord",
  "connector.discord.description":
    "People mention @OpenBot in a channel of a Discord server. The Discord Orchestrator asks the right agent and answers.",
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
  "connector.discord.workspaceTitle": "Discord servers",
  "connector.discord.workspaceDescription": "Mention @OpenBot in a channel. Reply to OpenBot to continue.",
  "connector.discord.disconnectWorkspace": "Disconnect",
  "connector.discord.disconnectAllTitle": "Disconnect Discord",
  "connector.discord.disconnectAllSummary":
    "Every server disconnects. People can no longer reach your agents through @OpenBot.",
  "connector.discord.disconnectAllSummaryOrchestrator":
    "Every server disconnects. The Discord Orchestrator and its conversations are deleted from OpenBot.",
  "connector.discord.missingScopes":
    "OpenBot does not have these permissions in Discord: {scopes}. Disconnect the Discord server, then connect it again.",
  "connector.discord.retryAt": "Discord asked OpenBot to wait. It tries again at {time}.",
  "connector.discord.reconnect": "Reconnect",
  "connector.discord.pause": "Pause",
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
  "connector.discord.disconnectDescriptionHost":
    "OpenBot stops answering in {workspace} and removes the Discord connection from {host}.",
  "connector.discord.disconnectEffect": "People in {workspace} can no longer reach your agents through @OpenBot.",
  "connector.discord.removeEffectKept": "The conversations and the Discord Orchestrator stay in OpenBot.",
  "connector.discord.removeEffectDeleted": "The Discord Orchestrator and its conversations are deleted from OpenBot.",
  "connector.discord.keep": "Keep connected",
  "connector.discord.close": "Close",
  "connector.discord.addWorkspace": "Add Discord server",
  "connector.discord.limitReached": {
    one: "You can connect a maximum of {count} Discord server.",
    other: "You can connect a maximum of {count} Discord servers.",
  },
  // {count} is the number of Discord servers: two or more.
  "connector.discord.summaryMany": {
    one: "{count} Discord server · Discord Orchestrator answers",
    other: "{count} Discord servers · Discord Orchestrator answers",
  },
  // Who can use OpenBot in one Discord server: the members with one of the chosen Discord roles.
  "connector.discord.accessTitle": "Who can use OpenBot",
  "connector.discord.accessDescription": "OpenBot answers only these people. It ignores mentions from others.",
  "connector.discord.accessEveryone": "Everyone in the server",
  "connector.discord.accessEveryoneDescription": "Anyone who can post in a channel that OpenBot sees can mention it.",
  // {roles} is a list of Discord role names, such as "Admin and Moderator".
  "connector.discord.accessRoles": "Members with {roles}",
  "connector.discord.accessChoose": "Choose roles",
  // {workspace} is the Discord server name.
  "connector.discord.accessDialogTitle": "Who can use OpenBot in {workspace}?",
  "connector.discord.accessDialogDescription": "With no role selected, everyone can mention OpenBot.",
  "connector.discord.accessLoading": "Loading roles…",
  "connector.discord.accessLoadFailed": "Discord roles did not load",
  "connector.discord.accessNoRoles": "This server has no roles to pick.",
  // {role} is the name of a Discord role that the server no longer has.
  "connector.discord.accessRoleDeleted": "{role} (deleted)",
  "connector.discord.accessSave": "Save",
  // {host} is the joined server's name.
  "connector.discord.accessHostUpdate": "Update OpenBot on {host} to choose roles.",

  // Marketplace > Apps > Telegram: each chat adds the one OpenBot bot, and the Telegram
  // Orchestrator agent receives the messages of all chats, asks the team and answers.
  "connector.telegram.title": "Telegram",
  "connector.telegram.description":
    "Add the OpenBot bot to a Telegram group or open a direct chat with it. The Telegram Orchestrator asks the right agent and answers.",
  "connector.telegram.statusConnected": "Connected",
  "connector.telegram.statusAttention": "Needs attention",
  // {count} is the number of linked Telegram chats.
  "connector.telegram.summaryConnected": {
    one: "{count} chat · Telegram Orchestrator answers",
    other: "{count} chats · Telegram Orchestrator answers",
  },
  "connector.telegram.summaryNoAgent": {
    one: "{count} chat · No agent answers yet",
    other: "{count} chats · No agent answers yet",
  },
  "connector.telegram.attentionTitle": {
    one: "{count} chat needs attention",
    other: "{count} chats need attention",
  },
  "connector.telegram.attentionDescription": "The status below says what to do.",
  "connector.telegram.connect": "Connect Telegram",
  "connector.telegram.addAgent": "Add agent",
  "connector.telegram.actionFailed": "Telegram did not accept the change",
  "connector.telegram.chatsTitle": "Chats",
  "connector.telegram.groupDescription": "People mention the bot or reply to its messages.",
  "connector.telegram.directDescription": "Every message in this chat goes to the Telegram Orchestrator.",
  "connector.telegram.helpRemoved":
    "The OpenBot bot is no longer in this chat. Disconnect the chat, then add the bot again.",
  "connector.telegram.helpRelayUnavailable":
    "OpenBot cannot receive Telegram messages on this computer. Sign in, give this computer a name in Server settings, and keep OpenBot open.",
  "connector.telegram.helpRelayUnavailableHost":
    "OpenBot on {host} cannot receive Telegram messages. On {host}, sign in, give the server a name in Server settings, and keep OpenBot open.",
  "connector.telegram.helpError": "OpenBot cannot reach this chat. Reconnect, or disconnect the chat.",
  "connector.telegram.retryAt": "Telegram asked OpenBot to wait. It tries again at {time}.",
  "connector.telegram.pause": "Pause",
  "connector.telegram.resume": "Resume",
  "connector.telegram.reconnect": "Reconnect",
  "connector.telegram.disconnectChat": "Disconnect",
  "connector.telegram.disconnectAllTitle": "Disconnect Telegram",
  "connector.telegram.disconnectAllSummary":
    "Every chat disconnects. People can no longer reach your agents through the OpenBot bot.",
  "connector.telegram.disconnectAllSummaryOrchestrator":
    "Every chat disconnects. The Telegram Orchestrator and its conversations are deleted from OpenBot.",
  // {action} is a button, such as Pause; {name} is the chat name.
  "connector.telegram.rowAction": "{action}: {name}",
  "connector.telegram.linkChat": "Link a chat",
  "connector.telegram.addToGroup": "Add to a group",
  "connector.telegram.openDirectChat": "Open a direct chat",
  "connector.telegram.orchestratorTitle": "Telegram Orchestrator",
  "connector.telegram.orchestratorDescription":
    "This agent receives the messages for OpenBot from all your Telegram chats. It answers short ones itself, gives other work to the right agent, and posts the answer in the chat.",
  "connector.telegram.orchestratorNone": "No agent answers yet",
  "connector.telegram.orchestratorNoneDescription": "Add the Telegram Orchestrator, or Telegram gets no answer.",
  "connector.telegram.mentionNote":
    "In a group, mention the bot or reply to its messages. In a direct chat, every message goes to the bot.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.telegram.stepChat": "Chat",
  "connector.telegram.stepAgent": "Agent",
  "connector.telegram.connectTitle": "Link a Telegram chat",
  "connector.telegram.connectDescription":
    "Add the OpenBot bot to a group, or open a direct chat with it. One bot serves all your chats.",
  "connector.telegram.connectStepBrowser": "Telegram opens in your browser",
  "connector.telegram.connectStepPick": "Select the group, or press Start in the direct chat",
  "connector.telegram.connectStepReturn": "This dialog continues when the chat is linked",
  "connector.telegram.connectWaiting": "Waiting for Telegram. Select the chat in Telegram.",
  "connector.telegram.agentStepTitle": "Add the Telegram Orchestrator",
  // {chat} is the Telegram chat name.
  "connector.telegram.agentStepDescription":
    "This new agent answers the messages for OpenBot in {chat} and in each chat that you link later.",
  "connector.telegram.orchestratorName": "Telegram Orchestrator",
  "connector.telegram.orchestratorRole": "Answers in Telegram and asks the team",
  "connector.telegram.orchestratorDoesReceive": "Receives every Telegram message for OpenBot first",
  "connector.telegram.orchestratorDoesDelegate": "Gives each task to the agent that fits best",
  "connector.telegram.orchestratorDoesAnswer": "Posts the answer in the Telegram chat",
  "connector.telegram.orchestratorModel": "Model",
  "connector.telegram.doneTitle": "OpenBot is in {chat}",
  "connector.telegram.done": "Done",
  "connector.telegram.disconnectTitle": "Disconnect {chat}?",
  "connector.telegram.leaveDescription": "The OpenBot bot leaves {chat}, and OpenBot stops answering there.",
  "connector.telegram.disconnectEffect": "People in {chat} can no longer reach your agents through the OpenBot bot.",
  "connector.telegram.removeEffectKept": "The conversations and the Telegram Orchestrator stay in OpenBot.",
  "connector.telegram.removeEffectDeleted":
    "This is the last chat, so the Telegram Orchestrator and its conversations are deleted from OpenBot.",
  "connector.telegram.keep": "Keep connected",
  "connector.telegram.close": "Close",
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
  "connector.onePassword.openAppFailed": "OpenBot could not open 1Password.",
  "connector.onePassword.checkAgain": "Check again",
  "connector.onePassword.stepVaultTitle": "Create the shared vault",
  "connector.onePassword.stepVaultDescription":
    "OpenBot creates the vault “Shared with OpenBot” and a service account that can only read it. 1Password asks you to approve.",
  // The last row of the setup steps: the other way to connect, without the CLI.
  "connector.onePassword.useTokenDescription":
    "Instead of these steps, paste a service account token from 1Password.com.",
  "connector.onePassword.useTokenAction": "Use token",
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
  "connector.onePassword.loginCount": { one: "{count} login", other: "{count} logins" },
  "connector.onePassword.disconnect": "Disconnect",
  "connector.onePassword.disconnectTitle": "Disconnect 1Password",
  "connector.onePassword.disconnectSummary":
    "OpenBot forgets the token. The vault and the service account stay in 1Password; remove them there if you no longer need them.",
  "connector.onePassword.actionFailed": "OpenBot could not change the 1Password connection.",
  "connector.onePassword.statusConnected": "Connected",
  "connector.onePassword.statusConnecting": "Connecting",
  // The same page for the connection of a joined server. {host} is the server name, such as Studio.
  "connector.onePassword.descriptionHost":
    "Share a dedicated 1Password vault with OpenBot on {host} through a service account, so agents on {host} can sign in to sites in its browser.",
  "connector.onePassword.howItWorksHost":
    "{host} connects with a service account token. On 1Password.com, create a service account that can read only the vault you share with OpenBot, then paste its token here. {host} checks the token and keeps it; this computer does not. Agents never see a password.",
  "connector.onePassword.disconnectSummaryHost":
    "{host} forgets the token. The vault and the service account stay in 1Password; remove them there if you no longer need them.",
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
  "connector.bitwarden.disconnectAction": "Disconnect",
  "connector.bitwarden.disconnectSummary":
    "OpenBot forgets the session key. Agents can no longer fill logins from Bitwarden. Other Bitwarden clients stay unlocked.",
  "connector.bitwarden.disconnectSummaryHost":
    "{host} removes the API key and the master password. Agents on {host} can no longer fill logins from Bitwarden.",
  "connector.bitwarden.connected": "Connected",
  "connector.bitwarden.actionFailed": "OpenBot could not change the Bitwarden connection.",
  "connector.bitwarden.descriptionHost": "Fill browser logins on {host} from Bitwarden or Vaultwarden.",
  "connector.bitwarden.setupHost":
    "{host} signs in with its own Bitwarden CLI. In your vault, create a folder named Shared with OpenBot and put only the logins that agents may use in it. In the web vault, open Settings › Security › Keys and view your API key. Enter the server address, client_id, client_secret and your master password below.",
  "connector.bitwarden.scopeHost":
    "All agents on {host} can use matching logins in Shared with OpenBot. OpenBot uses exact HTTPS origins. It does not use items that require a master password prompt or a custom URI match rule.",
  "connector.bitwarden.sessionHost":
    "{host} keeps the API key and the master password encrypted, so it can unlock again after a restart. This computer does not keep them. Disconnect removes them from {host}. {host} must reach the server address over HTTPS.",
  "connector.bitwarden.serverUrl": "Server address",
  "connector.bitwarden.folderTitle": "Shared folder",
  "connector.bitwarden.folderDescription":
    "Move a login into this folder in Bitwarden to let agents sign in with it. Remove it to stop.",
  // The exact folder name that OpenBot looks for in the vault. Keep it in English.
  "connector.bitwarden.folderName": "Shared with OpenBot",
  "connector.bitwarden.folderKind": "Folder in Bitwarden",
  "connector.bitwarden.clientId": "API key client_id",
  "connector.bitwarden.clientSecret": "API key client_secret",
  "connector.bitwarden.masterPassword": "Master password",
  "connector.bitwarden.connecting": "Connecting",
});
