import { defineMessages } from "../../message";

export const messages = defineMessages("plugin", {
  "plugin.link.website": "Website",
  "plugin.link.privacyPolicy": "Privacy Policy",
  "plugin.link.terms": "Terms of Service",
  "plugin.copyLink": "Copy link",
  "plugin.askPrompt": "Ask {name}: {prompt}",
  "plugin.section.skills": "Skills",
  "plugin.section.information": "Information",
  "plugin.info.developer": "Developer",
  "plugin.info.category": "Category",
  "plugin.info.version": "Version",

  "plugin.uninstallDialog.title": "Disconnect {name}?",
  "plugin.uninstallDialog.description":
    "This removes what {name} installed on this computer. Nothing else on this host or on this agent changes.",
  "plugin.uninstallDialog.confirm": "Disconnect",
  "plugin.uninstallDialog.appsLabel": "Apps to remove, {number}",
  "plugin.uninstallDialog.appsTitle": "Apps removed from this host",
  "plugin.uninstallDialog.appsNote":
    "Their tools stop being available, and any sign-in OpenBot kept for them is forgotten.",
  "plugin.uninstallDialog.skillsLabel": "Skills to remove, {number}",
  "plugin.uninstallDialog.skillsTitle": "Skills removed from {agentName}",
});
