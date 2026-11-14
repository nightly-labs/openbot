import { defineMessages } from "../../../message";

/** Errors that the workflow store and runtime send. */
export const messages = defineMessages("error.workflow", {
  "error.workflow.missing": "This workflow no longer exists.",
  "error.workflow.versionMissing": "This version of the workflow no longer exists.",
  "error.workflow.annotation": "Text, notes and shapes cannot have connections.",
  "error.workflow.port": "A step cannot take this type of input.",
  "error.workflow.branch": "Only a condition can have yes and no connections.",
  "error.workflow.conditionBranch": "Each connection from a condition must be yes or no.",
  "error.workflow.duplicateEdge": "These two steps already have this connection.",
  "error.workflow.serverTooOld": "This server does not support workflows. Update OpenBot on the computer that runs it.",
  "error.workflow.nodeUnsupported": "This version of OpenBot cannot run image, file and message steps yet.",
  "error.workflow.interrupted": "OpenBot stopped while this step ran. Run it again.",
  "error.workflow.agentMissing": "Choose an agent for this step.",
  "error.workflow.handoffFailed": "OpenBot could not send this step to its agent.",
  "error.workflow.agentStepEnded": "The agent's message for this step was removed before it answered.",
  "error.workflow.conditionUnclear": "The model did not answer yes or no.",
  "error.workflow.modelFailed": "The model could not answer. Run the step again.",
  "error.workflow.modelBusy": "Another model request is running. Run the step again soon.",
  "error.workflow.mediaFailed": "The model could not make the image or video. Run the step again.",
  "error.workflow.pictureMissing": "The picture is no longer on the server. Send it again.",
  "error.workflow.pictureType": "Use a PNG, JPEG or WebP picture.",
  "error.workflow.mediaInputMissing": "A picture from a step before this one is not available. Run that step again.",
  "error.workflow.mediaInputNotImage":
    "This step takes only pictures, not videos. Remove the connection from the video.",
  "error.workflow.stepMissing": "This step no longer exists.",
  "error.workflow.nodeMissing": "This step is not in the workflow.",
  "error.workflow.runMissing": "This run no longer exists.",
  "error.workflow.notRetryable": "Only a step that failed or stopped can run again.",
  "error.workflow.noDecision": "This step does not wait for a decision.",
  "error.workflow.outputPlaceMissing": "Choose a messaging place for this output.",
  "error.workflow.outputChannelMissing": "Choose a channel for this output.",
  "error.workflow.outputChannelFailed": "OpenBot could not post the result in the channel. Run the step again.",
  "error.workflow.discordNoMessage":
    "This output acts on the Discord message that started the run. Start the run from a Discord mention, or choose Post in channel.",
  "error.workflow.slackNoMessage":
    "This output acts on the Slack message that started the run. Start the run from a Slack mention, or choose Post in channel.",
  "error.workflow.telegramNoMessage":
    "This output acts on the Telegram message that started the run. Start the run from a Telegram mention, or choose Post in chat.",
  "error.workflow.outputConnectionOff":
    "The messaging connection of this output is off or removed. Choose a place again.",
  "error.workflow.outputNotRunning": "The messaging connection does not run now. Try again when it runs.",
  "error.workflow.outputRefused": "The place refused the post. Make sure that OpenBot can post there.",
  "error.workflow.outputUncertain":
    "The post stopped on its way. Part of it can be in the place. Look there before you try again.",
  "error.workflow.tooLarge": "This workflow is too large to save. Remove some drawings or long texts, then try again.",
  "error.workflow.tooLargeToSend":
    "This workflow is too large to send to another computer. Open it on the computer that runs the server.",
  "error.workflow.webhookMissing": "This step is not a webhook trigger. Save the workflow, then try again.",
  "error.workflow.githubActionMissing": "Choose what this output does on GitHub.",
  "error.workflow.githubRepositoryMissing": "Choose a repository for this output.",
  "error.workflow.githubItemMissing":
    "This output has no issue or pull request. Start the run from a GitHub event, or put the number in its input.",
  "error.workflow.githubPullRequestOnly": "This action works only on pull requests.",
  "error.workflow.githubTextMissing": "This output has no text to send. Connect a step that writes it.",
  "error.workflow.githubEventText":
    "This output cannot send the raw event of the trigger. Put an agent between the trigger and this output.",
  "error.workflow.githubChoiceMissing": "Choose the labels or the person for this output.",
  "error.workflow.githubChoseNothing": "The model chose no label or person of this repository.",
  "error.workflow.githubNotConnected": "Connect GitHub on the computer that runs this workflow.",
  "error.workflow.githubNoAccess":
    "The OpenBot GitHub App cannot see this repository or item. Open GitHub and give it access.",
  "error.workflow.githubNoWrite":
    "The OpenBot GitHub App cannot change this repository. Open GitHub and give it access.",
  "error.workflow.githubLocked": "This conversation is locked on GitHub.",
  "error.workflow.githubRefused": "GitHub refused the change: {detail}",
  "error.workflow.githubUnreachable": "OpenBot could not reach GitHub. Run the step again.",
  "error.workflow.githubUncertain":
    "The change stopped on its way. It can be on GitHub. Look there before you run the step again.",
  "error.workflow.githubNoEvent": "GitHub has no issue or pull request that this trigger starts on.",
  "error.workflow.sunraSignIn": "Sign in to Sunra in Apps to use Sunra models.",
  "error.workflow.sunraNoCredits":
    "Your Sunra account does not have sufficient credits. Add credits at sunra.ai/pricing, then run the step again.",
  "error.workflow.sunraNeedsPlan":
    "This Sunra model needs a Sunra plan. Get a plan at sunra.ai/pricing, or select a different model.",
  "error.workflow.sunraTeamInputs":
    "Sunra uses input pictures only with a Personal account. Select your Personal account in Sunra, or remove the picture connections.",
  "error.workflow.sunraFailed": "Sunra could not make the file: {reason}",
  "error.workflow.sunraTimeout":
    "Sunra did not finish the file in time. Look in the OpenBot project on sunra.ai before you run the step again.",
});
