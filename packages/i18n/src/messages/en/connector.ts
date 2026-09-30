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
  "connector.github.statusNotSetUp": "Not set up",
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

  // Server settings > Connectors > Slack: each agent can be its own Slack app in one workspace.
  "connector.slack.title": "Slack",
  "connector.slack.description":
    "Each agent can be its own Slack app, with its name and picture. People mention it in a channel or send it a direct message.",
  "connector.slack.statusNotSetUp": "Not set up",
  "connector.slack.statusConnected": "Connected",
  "connector.slack.statusAttention": "Needs attention",
  // {workspace} is the Slack workspace name.
  "connector.slack.summaryNoAgents": "{workspace} · No agents yet",
  "connector.slack.summaryAgents": { one: "{workspace} · {count} agent", other: "{workspace} · {count} agents" },
  "connector.slack.attentionTitle": { one: "{count} agent needs attention", other: "{count} agents need attention" },
  "connector.slack.attentionDescription": "The status of each agent below says what to do.",
  "connector.slack.connect": "Connect Slack",
  "connector.slack.addAgent": "Add agent",
  "connector.slack.actionFailed": "Slack did not accept the change",
  "connector.slack.workspaceTitle": "Workspace",
  "connector.slack.workspaceNone": "No workspace connected",
  "connector.slack.workspaceNoneDescription": "Slack opens in your browser, and you select the workspace there.",
  "connector.slack.workspaceDescription": "OpenBot creates the Slack app of each agent in this workspace.",
  "connector.slack.disconnectWorkspace": "Disconnect",
  "connector.slack.agentsTitle": "Agents",
  // {live} is the number of agents that answer in Slack now; {count} is the number of agents in Slack.
  "connector.slack.agentsDescription": {
    one: "{live} of {count} agent answers in Slack.",
    other: "{live} of {count} agents answer in Slack.",
  },
  "connector.slack.agentsNone": "Add an agent to give it its own Slack app.",
  "connector.slack.limit": "A free Slack workspace allows up to 10 apps, and each agent uses one.",
  "connector.slack.warning":
    "Anyone who can post in the Slack workspace can give these agents work. They run on this computer with the access you gave them, and a hosted server stays awake while Slack is connected.",
  "connector.slack.tableCaption": "The Slack app of each agent",
  "connector.slack.columnAgent": "Agent",
  "connector.slack.columnStatus": "Status",
  "connector.slack.columnActions": "Actions",
  "connector.slack.notAdded": "Not in Slack",
  "connector.slack.statusNotAdded": "Not added",
  "connector.slack.missingScopes":
    "The Slack app does not have these permissions: {scopes}. Remove the agent, then add it again.",
  "connector.slack.retryAt": "Slack asked OpenBot to wait. It tries again at {time}.",
  "connector.slack.addToSlack": "Add to Slack",
  "connector.slack.continueInstall": "Continue",
  "connector.slack.reconnect": "Reconnect",
  "connector.slack.pause": "Pause",
  "connector.slack.resume": "Resume",
  "connector.slack.remove": "Remove",
  // {action} is a button, such as Pause; {name} is the agent name.
  "connector.slack.rowAction": "{action}: {name}",
  "connector.slack.removeTitle": "Remove {name} from Slack?",
  "connector.slack.removeDescription": "OpenBot deletes the Slack app of {name} and its tokens on this computer.",
  "connector.slack.removeEffectApp": "People in Slack can no longer mention {name}.",
  "connector.slack.removeEffectKept": "The conversations stay in OpenBot.",
  "connector.slack.keep": "Keep in Slack",
  "connector.slack.close": "Close",
  // The dialog that adds an agent. The steps show as numbers; screen readers read the names.
  "connector.slack.stepAgent": "Agent",
  "connector.slack.stepPreview": "Preview",
  "connector.slack.stepCreate": "Create app",
  "connector.slack.stepInstall": "Install",
  "connector.slack.pickTitle": "Which agent joins Slack?",
  "connector.slack.pickDescription": "Each agent becomes its own Slack app.",
  "connector.slack.pickLegend": "Agents",
  "connector.slack.alreadyAdded": "Already in Slack",
  "connector.slack.previewTitle": "This is {name} in Slack",
  "connector.slack.previewDescription": "Slack uses the agent's name and picture. Change them in agent settings.",
  "connector.slack.previewLabel": "How {name} looks in Slack",
  // A sample Slack channel name, shown without the # sign.
  "connector.slack.previewChannel": "general",
  // The label Slack shows next to the name of an app.
  "connector.slack.previewApp": "APP",
  "connector.slack.previewMessage": "Hi, I am {name}. Mention me in a channel, or send me a direct message.",
  "connector.slack.createTitle": "Create the Slack app",
  "connector.slack.createDescription": "OpenBot fills in the app settings. You only confirm in Slack.",
  "connector.slack.createIdentity": "App name and picture from {name}",
  "connector.slack.createScopes": "Permissions: read mentions, post messages, join public channels",
  "connector.slack.createConfirm": "Confirm “Create” in Slack",
  "connector.slack.createInSlack": "Create in Slack",
  "connector.slack.installTitle": "Install it in your workspace",
  "connector.slack.installDescription": "Slack asks you to allow the app. OpenBot waits here.",
  "connector.slack.installWaiting": "Waiting for Slack to confirm the install in {workspace}.",
  "connector.slack.openSlack": "Open Slack",
  "connector.slack.doneTitle": "{name} is in Slack",
  "connector.slack.doneDescription": "Mention {name} in a channel, or send it a direct message.",
  "connector.slack.done": "Done",
  "connector.slack.back": "Back",
  "connector.slack.continue": "Continue",
});
