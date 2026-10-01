import { defineMessages } from "../../message";

export const messages = defineMessages("marketplace", {
  // The listing: categories, rows, and the words for each kind of listing.
  "marketplace.category.coding": "Coding",
  "marketplace.category.design": "Design",
  "marketplace.category.dataAnalytics": "Data & Analytics",
  "marketplace.category.documents": "Documents",
  "marketplace.category.productivity": "Productivity",
  "marketplace.category.research": "Research",
  "marketplace.category.automation": "Automation",
  "marketplace.category.other": "Other",
  "marketplace.loadFailed": "Could not load the marketplace.",
  "marketplace.loading.skills": "Loading skills",
  "marketplace.loading.agents": "Loading agents",
  "marketplace.noMatch.skills": "No skills match this search.",
  "marketplace.noMatch.agents": "No agents match this search.",
  "marketplace.loadMore": "Load more",
  "marketplace.version": "Version {version}",

  // The dialog frame: title, close and tabs.
  "marketplace.title": "Marketplace",
  "marketplace.close": "Close marketplace",
  "marketplace.kinds": "Marketplace content types",
  "marketplace.tab.agents": "Agents",
  "marketplace.tab.skills": "Skills",

  // A plugin link.
  "marketplace.plugins.missing": "This plugin is not in the OpenBot catalog.",

  // The agent page.
  "marketplace.agents.loadingDetail": "Loading agent details…",
  "marketplace.agents.skills": "Skills",
  "marketplace.agents.routines": "Routines",
  "marketplace.agents.routineActive": "Active",
  "marketplace.agents.routineInactive": "Inactive",

  // The skill page, and why Try is off.
  "marketplace.skill.loading": "Loading skill",
  "marketplace.skill.update": "Update skill",
  "marketplace.try.readFailed": "OpenBot could not read this agent's skills. Try again.",
  "marketplace.try.enable": "Enable this skill in agent settings to try it.",
  "marketplace.try.repair": "Repair this skill in agent settings to try it.",
  "marketplace.try.update": "Update this skill to try this version.",
  "marketplace.try.composerUnavailable": "The agent composer is unavailable.",

  // The Marketplace window. {name} is an agent, app or skill name. {count} is a number.
  "marketplace.open": "Open {name}",
  "marketplace.tab.apps": "Apps",
  "marketplace.crumbs.label": "Location",
  "marketplace.search.label": "Search the marketplace",
  "marketplace.search.placeholder": "Search",
  "marketplace.installs": { one: "{installs} install", other: "{installs} installs" },
  "marketplace.filter": "Filter",
  "marketplace.filter.on": "Filter: {filters}",
  "marketplace.filter.all": "All",
  "marketplace.filter.status": "Status",
  "marketplace.filter.category": "Category",
  "marketplace.filter.added": "Added",
  "marketplace.filter.notAdded": "Not added",
  "marketplace.filter.installed": "Installed",
  "marketplace.filter.notInstalled": "Not installed",
  "marketplace.filter.clear": "Clear filters",
  "marketplace.noMatch.apps": "No apps match this search.",
  "marketplace.noMatch.filters": "Nothing matches the filters.",
  "marketplace.noMatch.showAgents": { one: "Show {count} agent", other: "Show {count} agents" },
  "marketplace.noMatch.showApps": { one: "Show {count} app", other: "Show {count} apps" },
  "marketplace.noMatch.showSkills": { one: "Show {count} skill", other: "Show {count} skills" },
  "marketplace.empty.agents": "No agents are in the marketplace yet.",
  "marketplace.empty.apps": "No apps are in the marketplace yet.",
  "marketplace.empty.skills": "No skills are in the marketplace yet.",
  "marketplace.properties.agent": "About this agent",
  "marketplace.properties.skill": "About this skill",
  "marketplace.properties.creator": "Creator",
  "marketplace.properties.category": "Category",
  "marketplace.properties.version": "Version",
  "marketplace.properties.updated": "Updated",
  "marketplace.properties.installs": "Installs",

  // Agents.
  "marketplace.agent.add": "Add",
  "marketplace.agent.addNamed": "Add {name}",
  "marketplace.agent.addAgent": "Add agent",
  "marketplace.agent.added": "Added",
  "marketplace.agent.updateAvailable": "Update available",
  "marketplace.agent.update": "Update",
  "marketplace.agent.openChat": "Open chat",

  // Apps.
  "marketplace.app.connect": "Connect",
  "marketplace.app.reconnect": "Reconnect",
  "marketplace.app.connectNamed": "Connect {name}",
  "marketplace.app.reconnectNamed": "Reconnect {name}",
  "marketplace.app.connected": "Connected",
  "marketplace.app.attention": "Needs attention",
  "marketplace.app.notConnected": "Not connected",
  "marketplace.app.custom": "MCP server",
  "marketplace.app.githubTagline": "Repositories, issues and pull requests",
  "marketplace.app.yourApps": "Your apps",
  "marketplace.app.moreApps": "More apps",
  "marketplace.app.server": "Server",
  "marketplace.app.command": "Command",
  "marketplace.app.address": "Address",
  "marketplace.app.disconnect.title": "Disconnect",
  "marketplace.app.disconnect.description":
    "Remove {name} and its skills from this computer. You can connect it again later.",
  "marketplace.app.disconnect.action": "Disconnect",
  "marketplace.app.remove.title": "Remove server",
  "marketplace.app.remove.description": "Your agents can no longer use this server. Its settings are deleted.",
  "marketplace.app.remove.action": "Remove",
  "marketplace.app.remove.confirmTitle": "Remove {name}?",
  "marketplace.app.remove.keep": "Keep",

  // Skills. {label} is the install button text: an agent name, "All agents" or "2 agents".
  "marketplace.skill.installMenu.install": "Install",
  "marketplace.skill.installMenu.installNamed": "Install {name}",
  "marketplace.skill.installMenu.allAgents": "All agents",
  "marketplace.skill.installMenu.agents": { one: "{count} agent", other: "{count} agents" },
  "marketplace.skill.installMenu.here": "You're here",
  "marketplace.skill.installMenu.change": {
    one: "{label} has {name}. Change",
    other: "{label} have {name}. Change",
  },
  "marketplace.skill.doc": "SKILL.md",
  "marketplace.try.in": "Try in {name}",

  // Results that a screen reader hears. {agents} is a list of agent names.
  "marketplace.notice.agentAdded": "{name} added.",
  "marketplace.notice.agentUpdated": "{name} updated.",
  "marketplace.notice.appConnected": "{name} connected.",
  "marketplace.notice.appDisconnected": "{name} disconnected.",
  "marketplace.notice.serverRemoved": "{name} removed.",
  "marketplace.notice.skillInstalled": {
    one: "{name} installed on {count} agent.",
    other: "{name} installed on {count} agents.",
  },
  "marketplace.notice.skillRemoved": {
    one: "{name} removed from {count} agent.",
    other: "{name} removed from {count} agents.",
  },
  "marketplace.error.skillPartial": "{name} did not change on these agents: {agents}. {reason}",

  // Errors. {reason} is an error message. {failures} is a list of error messages.
  "marketplace.error.openLink": "Could not open the link.",
  "marketplace.error.copyLink": "Could not copy the link.",
  "marketplace.error.connectNoServer": "Select a local server to connect this app.",
  "marketplace.error.installNoServer": "Select a local server to install a plugin.",
  "marketplace.error.installNoAgent": "Choose an agent to install this plugin's skills.",
  "marketplace.error.installLocalOnHost":
    "Install {name} on the computer that runs these agents: its app runs its server on that computer.",
  "marketplace.error.installOnHost":
    "Install {name} on the computer that runs these agents: its app needs a browser sign-in.",
  "marketplace.error.appInvalid": "{name} cannot be added: {reason}",
  "marketplace.error.uninstallNoServer": "Select a local server to uninstall a plugin.",
  "marketplace.error.uninstallPartial": "Some of {name} could not be removed. {failures}",
  "marketplace.error.actionFailed": "Could not complete the marketplace action. Try again.",
  "marketplace.thisAgent": "this agent",
});
