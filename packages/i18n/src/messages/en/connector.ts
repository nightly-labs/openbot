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
});
