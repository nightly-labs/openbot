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

/**
 * Receives the notifications of OpenBot hosts from Firebase Cloud Messaging, also while the app does
 * not run. A host sends the agent name and the text through the OpenBot relay and Google, sealed with
 * keys that only this phone and the host know, so the relay and Google see the app name only. This
 * service opens the seal (`SealedNotification`) and gives the notification to `expo-notifications`,
 * which shows it, or asks the app first when the app is on screen. A tap then reaches the app as on
 * iOS. A notification that no key opens shows the app name only, so a host credential alone cannot
 * make the phone show its own text.
 *
 * The relay sends a data message with `sealed` and, unless the notification is silent, `sound`
 * (`android-notification-relay.ts` in the account service). Other messages go to `expo-notifications`.
 */
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
    // The agent picture is the large icon. Without one, the notification shows as before.
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
    // `expo-notifications` gives the app this object as the notification data.
    if (opened != null) builder.setBody(opened.data())
    // Android 8 and later play the sound of the channel. Earlier versions play the sound of the content.
    when {
      sound == null -> builder.setSound(null).setVibrationPattern(null)
      SOUND_RESOURCES.containsKey(sound) ->
        builder.setSound(Uri.parse("android.resource://$packageName/raw/${SOUND_RESOURCES.getValue(sound)}"))
    }
    return builder.build()
  }

  companion object {
    /** The title until the app opens the seal. A brand name, so it is the same in every language. */
    private const val APP_NAME = "OpenBot"

    /** The sounds of `NOTIFICATION_SOUND_FILES`, as `with-notification-sounds.js` names their copies. */
    private val SOUND_RESOURCES = mapOf(
      "openbot" to "openbot_task",
      "warm" to "openbot_warm",
      "mech" to "openbot_mech",
      "bubble" to "openbot_bubble",
      "press" to "openbot_press",
    )

    /** The channel of each sound, which the app creates (`android-notification-channels.ts`). */
    private fun channelId(sound: String?): String = when {
      sound == null -> "openbot.sound.none"
      SOUND_RESOURCES.containsKey(sound) -> "openbot.sound.$sound.v2"
      else -> "openbot.sound.default"
    }
  }
}
