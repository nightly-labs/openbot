import { defineMessages } from "../../../message";

export const messages = defineMessages("status.agent", {
  "status.agent.claudeWriteOutside":
    "Write {path}, outside the agent's workspace, the shared folder and the temporary folders.",
  "status.agent.contextCleared": "Context cleared. A new chat starts here.",
  "status.agent.modelSwitchedForLimit": "Usage limit reached. Switched to {model}.",
  "status.agent.modelReturnedAfterLimit": "Usage limit ended. Switched back to {model}.",
  "status.agent.modelSwitchedForError": "Provider error. Switched to {model}.",
  "status.agent.modelReturnedAfterError": "Switched back to {model} after the provider error.",
  "status.agent.marketplaceSuggested": "Suggested a Marketplace app: {app}.",
  "status.agent.channelMemberAdded": "{agent} added {member} to the channel. {person} asked for it.",
  "status.agent.channelMemberRemoved": "{agent} removed {member} from the channel. {person} asked for it.",
  "status.agent.channelInstructionsChanged": "{agent} changed the channel instructions. {person} asked for it.",
  "status.agent.channelRoutineCreated": "{agent} created the routine {routine}. {person} asked for it.",
  "status.agent.channelRoutineUpdated": "{agent} changed the routine {routine}. {person} asked for it.",
  "status.agent.channelRoutineDeleted": "{agent} deleted the routine {routine}. {person} asked for it.",
  "status.agent.screenCaptureScreen": "Capture the main screen and send the image to the agent's model.",
  "status.agent.screenCaptureChannel":
    "The image shows in the channel {channel}, and each member of this server who reads the channel can see it.",
  "status.agent.screenCaptureDisplay": "Capture the display {name} and send the image to the agent's model.",
  "status.agent.screenCaptureWindow": "Capture the window {name} and send the image to the agent's model.",
  "status.agent.screenCaptureRegion":
    "Capture the screen area at {x}, {y}, {width} × {height} points and send the image to the agent's model.",
  "status.agent.vaultCardFill":
    "Fill the saved card {card} on {site}. After you approve, agents can fill this card on this site with no approval. Remove the site in Server settings > Vault.",
  "status.agent.vaultCardFillFrames": "The card fields are in frames from {origins}.",
  "status.agent.screenCaptureProgress": "Asking to capture the screen…",
  "status.agent.screenCaptureReviewing": "Reviewing the screen capture…",
  "status.agent.browserOpening": "Opening a web page…",
  "status.agent.browserReading": "Reading the web page…",
  "status.agent.browserClicking": "Clicking on the web page…",
  "status.agent.browserTyping": "Typing on the web page…",
  "status.agent.browserActing": "Using the web page…",
  "status.agent.browserReviewing": "Reviewing the web page…",
  "status.agent.memoriesSearching": "Searching its memories…",
  "status.agent.memoriesSearched": {
    one: "Searched its memories: {count} found",
    other: "Searched its memories: {count} found",
  },
  "status.agent.memoriesUpdating": "Updating its memories…",
  "status.agent.skillUsing": "Using the skill {name}…",
  "status.agent.skillReading": "Reading a skill…",
  "status.agent.memoryChanges": "Memory: {saved} saved, {updated} updated, {forgotten} forgotten.",
  "status.agent.memoryChangesWithConflicts":
    "Memory: {saved} saved, {updated} updated, {forgotten} forgotten, {notChanged} not changed because another thread changed it first.",
  "status.agent.mcpServerAdd":
    "Add the MCP server {name}: {target}. Every agent on this server gets its tools. OpenBot connects to it to test it.",
  "status.agent.mcpServerChange":
    "Change the MCP server {name} to {target}. Every agent on this server gets its tools. OpenBot connects to it to test it.",
  "status.agent.mcpServerEnable": "Turn on the MCP server {name} for every agent on this server.",
  "status.agent.mcpServerDisable": "Turn off the MCP server {name} for every agent on this server.",
  "status.agent.mcpServerRemove": "Remove the MCP server {name} and its sign-in from every agent on this server.",
  "status.agent.mcpSignInRequested": "The MCP server {name} needs a sign-in. Sign in from Server settings, MCP.",
  "status.agent.vaultAdded": "Saved to Vault: {name}",
  "status.agent.vaultUpdated": "Changed in Vault: {name}",
  "status.agent.vaultDeleted": "Deleted from Vault: {name}",
  "status.agent.planContinues": "The plan has open steps. The agent continues ({current} of {limit}).",
  "status.agent.branchTitle": "Branched chat",
});
