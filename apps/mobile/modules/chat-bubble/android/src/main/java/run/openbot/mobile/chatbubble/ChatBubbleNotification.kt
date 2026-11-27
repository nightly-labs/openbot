package run.openbot.mobile.chatbubble

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.Bitmap
import android.graphics.drawable.Icon
import android.os.Build
import org.json.JSONObject
import java.io.File

/**
 * The bubble of one agent: its shortcut, its channel and its notification. The app writes the
 * agents that have a bubble into `chat-bubble.json` in its files folder (`chat-bubble-config.ts`).
 *
 * Android shows a bubble only when the notification references a long-lived shortcut, the channel
 * allows bubbles, and the user allows bubbles for the app. When one of these is missing, the caller
 * posts the notification as before.
 */
object ChatBubbleNotification {
  const val CHANNEL_ID = "openbot.bubble"
  const val EXTRA_SERVER_ID = "serverId"
  const val EXTRA_AGENT_ID = "agentId"
  private const val CONFIG_FILE = "chat-bubble.json"
  private const val CHANNEL_NAME = "Chat bubbles"

  fun shortcutId(serverId: String, agentId: String): String = "agent/$serverId/$agentId"

  /** One id per agent, so a newer message replaces the bubble of the same agent. */
  fun notificationId(serverId: String, agentId: String): Int = shortcutId(serverId, agentId).hashCode()

  fun isEnabled(context: Context, serverId: String, agentId: String): Boolean {
    val json = try {
      JSONObject(File(context.filesDir, CONFIG_FILE).readText(Charsets.UTF_8))
    } catch (error: Exception) {
      return false
    }
    if (json.optInt("version") != 1 || !json.optBoolean("enabled")) return false
    val agents = json.optJSONArray("agents") ?: return true
    if (agents.length() == 0) return true
    val key = "$serverId:$agentId"
    return (0 until agents.length()).any { agents.optString(it) == key }
  }

  fun post(
    context: Context,
    serverId: String,
    agentId: String,
    title: String,
    text: String?,
    serverName: String?,
    avatar: Bitmap?,
  ): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.R) return false
    val manager = context.getSystemService(NotificationManager::class.java) ?: return false
    if (!manager.areBubblesEnabled()) return false
    if (!isEnabled(context, serverId, agentId)) return false
    val id = shortcutId(serverId, agentId)
    val intent = Intent(context, ChatBubbleActivity::class.java)
      .putExtra(EXTRA_SERVER_ID, serverId)
      .putExtra(EXTRA_AGENT_ID, agentId)
      .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TOP)
    if (!publishShortcut(context, id, title, avatar, intent)) return false
    ensureChannel(manager)
    val pending = PendingIntent.getActivity(
      context,
      notificationId(serverId, agentId),
      intent,
      PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT,
    )
    val bubble = Notification.BubbleMetadata.Builder(id)
      .setSuppressNotification(true)
      .build()
    val builder = Notification.Builder(context, CHANNEL_ID)
      .setSmallIcon(smallIcon(context))
      .setContentTitle(title)
      .setContentText(text)
      .setSubText(serverName)
      .setContentIntent(pending)
      .setShortcutId(id)
      .setBubbleMetadata(bubble)
      .setCategory(Notification.CATEGORY_MESSAGE)
      .setOnlyAlertOnce(true)
    if (avatar != null) builder.setLargeIcon(avatar)
    manager.notify(notificationId(serverId, agentId), builder.build())
    return true
  }

  fun dismiss(context: Context, serverId: String, agentId: String) {
    val manager = context.getSystemService(NotificationManager::class.java) ?: return
    manager.cancel(notificationId(serverId, agentId))
  }

  /** Android shows no bubble for a shortcut that is not long-lived or not published. */
  private fun publishShortcut(
    context: Context,
    id: String,
    title: String,
    avatar: Bitmap?,
    intent: Intent,
  ): Boolean {
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return false
    val label = title.ifBlank { context.applicationInfo.loadLabel(context.packageManager).toString() }
    val icon = avatar?.let { Icon.createWithBitmap(it) } ?: Icon.createWithResource(context, smallIcon(context))
    val shortcut = ShortcutInfo.Builder(context, id)
      .setShortLabel(label)
      .setLongLabel(label)
      .setIcon(icon)
      .setIntent(intent)
      .setLongLived(true)
      .build()
    return try {
      manager.pushDynamicShortcut(shortcut)
      true
    } catch (error: IllegalArgumentException) {
      false
    } catch (error: IllegalStateException) {
      false
    }
  }

  private fun ensureChannel(manager: NotificationManager) {
    if (manager.getNotificationChannel(CHANNEL_ID) != null) return
    val channel = NotificationChannel(CHANNEL_ID, CHANNEL_NAME, NotificationManager.IMPORTANCE_HIGH)
    channel.setSound(null, null)
    channel.enableVibration(false)
    manager.createNotificationChannel(channel)
  }

  /** The icon of `expo-notifications`, as `ExpoNotificationBuilder` reads it. */
  private fun smallIcon(context: Context): Int {
    val metaData = try {
      context.packageManager.getApplicationInfo(context.packageName, PackageManager.GET_META_DATA).metaData
    } catch (error: Exception) {
      null
    }
    val declared = metaData?.getInt("expo.modules.notifications.default_notification_icon") ?: 0
    return if (declared != 0) declared else context.applicationInfo.icon
  }
}
