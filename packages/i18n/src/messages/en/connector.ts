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
  "connector.slack.workspaceNone": "No workspace connected",
  "connector.slack.workspaceNoneDescription": "Slack opens in your browser, and you select the workspace there.",
  "connector.slack.workspaceDescription": "People mention @OpenBot or send it a direct message.",
  "connector.slack.disconnectWorkspace": "Disconnect",
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
  "connector.slack.inviteNote": "To use OpenBot in a channel, invite it there: /invite @OpenBot.",
  "connector.slack.warning":
    "Anyone who can post in the Slack workspace can give these agents work. They run on this computer with the access you gave them, and a hosted server stays awake while Slack is connected.",
  // The connect dialog. The steps show as numbers; screen readers read the names.
  "connector.slack.stepWorkspace": "Workspace",
  "connector.slack.stepAgent": "Agent",
  "connector.slack.connectTitle": "Connect a Slack workspace",
  "connector.slack.connectDescription": "OpenBot installs one app in the workspace, named OpenBot.",
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
  "connector.slack.doneDescription": "Invite @OpenBot to a channel and mention it, or send it a direct message.",
  "connector.slack.done": "Done",
  "connector.slack.previewLabel": "How OpenBot looks in Slack",
  // A sample Slack channel name, shown without the # sign.
  "connector.slack.previewChannel": "general",
  // The name of the Slack app. Do not translate.
  "connector.slack.previewName": "OpenBot",
  // The label Slack shows next to the name of an app.
  "connector.slack.previewApp": "APP",
  "connector.slack.previewMessage": "Research is checking this. The answer comes here.",
  "connector.slack.disconnectTitle": "Disconnect {workspace}?",
  "connector.slack.disconnectDescription":
    "OpenBot stops answering in {workspace} and removes its Slack token from this computer.",
  "connector.slack.disconnectEffect": "People in {workspace} can no longer reach your agents through @OpenBot.",
  "connector.slack.removeEffectKept": "The conversations and the Slack Orchestrator stay in OpenBot.",
  "connector.slack.keep": "Keep connected",
  "connector.slack.close": "Close",
});
