package run.openbot.mobile.notifications

import android.content.Context
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.os.Parcel
import android.os.Parcelable
import expo.modules.notifications.notifications.interfaces.INotificationContent
import expo.modules.notifications.notifications.model.NotificationContent
import org.json.JSONObject
import java.io.File
import java.io.Serializable

internal class AgentNotificationContent(
  private val content: NotificationContent,
  private val avatarPath: String,
) : INotificationContent by content, Serializable {

  constructor(parcel: Parcel) : this(
    parcel.readParcelable<NotificationContent>(NotificationContent::class.java.classLoader)!!,
    parcel.readString()!!,
  )

  override fun containsImage(): Boolean = true

  override suspend fun getImage(context: Context): Bitmap? =
    NotificationAvatars.decode(avatarPath) ?: (content as INotificationContent).getImage(context)

  override fun describeContents(): Int = 0

  override fun writeToParcel(dest: Parcel, flags: Int) {
    dest.writeParcelable(content, flags)
    dest.writeString(avatarPath)
  }

  companion object CREATOR : Parcelable.Creator<AgentNotificationContent> {
    override fun createFromParcel(parcel: Parcel): AgentNotificationContent = AgentNotificationContent(parcel)

    override fun newArray(size: Int): Array<AgentNotificationContent?> = arrayOfNulls(size)
  }
}

internal object NotificationAvatars {
  private const val INDEX_FILE = "notification-avatars.json"
  private const val AVATAR_FOLDER = "notification-avatars"
  private const val MAX_PIXELS = 192

  fun file(context: Context, serverId: String, agentId: String): File? =
    try {
      val index = File(context.filesDir, INDEX_FILE)
      val json = JSONObject(index.readText())
      val agents = json.optJSONArray("agents")
      if (json.optInt("version") != 1 || agents == null) {
        null
      } else {
        (0 until agents.length())
          .mapNotNull { agents.optJSONObject(it) }
          .firstOrNull { it.optString("serverId") == serverId && it.optString("id") == agentId }
          ?.optString("avatar")
          ?.takeIf { it.isNotEmpty() && !it.contains('/') && it != ".." }
          ?.let { File(File(context.filesDir, AVATAR_FOLDER), it) }
          ?.takeIf { it.isFile }
      }
    } catch (error: Exception) {
      null
    }

  fun decode(path: String): Bitmap? {
    val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
    BitmapFactory.decodeFile(path, bounds)
    if (bounds.outWidth <= 0 || bounds.outHeight <= 0) return null
    var sample = 1
    while (minOf(bounds.outWidth, bounds.outHeight) / (sample * 2) >= MAX_PIXELS) sample *= 2
    return BitmapFactory.decodeFile(path, BitmapFactory.Options().apply { inSampleSize = sample })
  }
}
