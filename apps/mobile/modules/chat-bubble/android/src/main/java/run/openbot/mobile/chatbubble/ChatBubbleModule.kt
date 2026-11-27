package run.openbot.mobile.chatbubble

import android.app.NotificationManager
import android.content.Intent
import android.os.Build
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

class BubbleTarget : Record {
  @Field var serverId: String = ""
  @Field var agentId: String = ""
}

/**
 * The bridge of the chat bubble. `currentTarget` reads the extras of the bubble activity, so the
 * second React Native root knows which chat to show. `dismiss` removes the bubble of an agent that
 * the user has read.
 */
class ChatBubbleModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenBotChatBubble")

    Function("isSupported") { Build.VERSION.SDK_INT >= Build.VERSION_CODES.R }

    Function("areBubblesEnabled") { bubblesEnabled() }

    Function("openBubbleSettings") { openBubbleSettings() }

    Function("currentTarget") { currentTarget() }

    Function("dismiss") { serverId: String, agentId: String ->
      val context = appContext.reactContext ?: return@Function
      ChatBubbleNotification.dismiss(context, serverId, agentId)
    }

    Function("close") {
      appContext.currentActivity?.finish()
      Unit
    }

    Function("openApp") {
      val context = appContext.reactContext ?: return@Function
      val intent = context.packageManager.getLaunchIntentForPackage(context.packageName) ?: return@Function
      intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
      runCatching { context.startActivity(intent) }
      Unit
    }
  }

  private fun bubblesEnabled(): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    val context = appContext.reactContext ?: return false
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    return manager.areBubblesEnabled() && manager.bubblePreference != NotificationManager.BUBBLE_PREFERENCE_NONE
  }

  private fun openBubbleSettings() {
    val context = appContext.reactContext ?: return
    val intent = Intent(Settings.ACTION_APP_NOTIFICATION_BUBBLE_SETTINGS)
      .putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    runCatching { context.startActivity(intent) }
  }

  private fun currentTarget(): BubbleTarget? {
    val activity = appContext.currentActivity as? ChatBubbleActivity ?: return null
    val intent = activity.intent ?: return null
    val serverId = intent.getStringExtra(ChatBubbleNotification.EXTRA_SERVER_ID) ?: return null
    val agentId = intent.getStringExtra(ChatBubbleNotification.EXTRA_AGENT_ID) ?: return null
    return BubbleTarget().apply {
      this.serverId = serverId
      this.agentId = agentId
    }
  }
}
