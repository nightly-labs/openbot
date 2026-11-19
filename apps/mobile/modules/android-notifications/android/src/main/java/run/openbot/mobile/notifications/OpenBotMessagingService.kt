package run.openbot.mobile.notifications

import android.net.Uri
import com.google.firebase.messaging.RemoteMessage
import expo.modules.notifications.notifications.enums.NotificationPriority
import expo.modules.notifications.notifications.model.Notification
import expo.modules.notifications.notifications.model.NotificationContent
import expo.modules.notifications.notifications.model.NotificationRequest
import expo.modules.notifications.notifications.triggers.ChannelAwareTrigger
import expo.modules.notifications.service.ExpoFirebaseMessagingService
import expo.modules.notifications.service.NotificationsService
import java.util.Date
import java.util.UUID

class OpenBotMessagingService : ExpoFirebaseMessagingService() {
  override fun onMessageReceived(remoteMessage: RemoteMessage) {
    val sealed = remoteMessage.data["sealed"]
    if (sealed == null) {
      super.onMessageReceived(remoteMessage)
      return
    }
    val sound = remoteMessage.data["sound"]
    val opened = SealedNotification.open(this, sealed)
    val identifier = remoteMessage.messageId ?: UUID.randomUUID().toString()
    val base = content(opened, sound)
    val avatar = opened?.let { NotificationAvatars.file(this, it.serverId, it.agentId) }
    val shown = if (avatar == null) base else AgentNotificationContent(base, avatar.path)
    val request = NotificationRequest(identifier, shown, ChannelAwareTrigger(channelId(sound)))
    val sent = remoteMessage.sentTime
    NotificationsService.receive(this, Notification(request, if (sent > 0) Date(sent) else Date()))
  }

  private fun content(opened: OpenedNotification?, sound: String?): NotificationContent {
    val builder = NotificationContent.Builder()
      .setTitle(opened?.title ?: APP_NAME)
      .setText(opened?.body)
      .setSubtitle(opened?.serverName)
      .setPriority(NotificationPriority.HIGH)
      .setAutoDismiss(true)
    if (opened != null) builder.setBody(opened.data())
    when {
      sound == null -> builder.setSound(null).setVibrationPattern(null)
      SOUND_RESOURCES.containsKey(sound) ->
        builder.setSound(Uri.parse("android.resource://$packageName/raw/${SOUND_RESOURCES.getValue(sound)}"))
    }
    return builder.build()
  }

  companion object {
    private const val APP_NAME = "OpenBot"

    private val SOUND_RESOURCES = mapOf(
      "openbot" to "openbot_task",
      "warm" to "openbot_warm",
      "mech" to "openbot_mech",
      "bubble" to "openbot_bubble",
      "press" to "openbot_press",
    )

    private fun channelId(sound: String?): String = when {
      sound == null -> "openbot.sound.none"
      SOUND_RESOURCES.containsKey(sound) -> "openbot.sound.$sound.v2"
      else -> "openbot.sound.default"
    }
  }
}
