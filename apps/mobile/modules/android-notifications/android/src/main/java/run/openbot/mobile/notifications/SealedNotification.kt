package run.openbot.mobile.notifications

import android.content.Context
import android.util.Base64
import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject
import java.io.File
import java.io.IOException
import java.nio.ByteBuffer
import java.security.MessageDigest
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

internal data class OpenedNotification(
  val serverId: String,
  val agentId: String,
  val threadId: String?,
  val kind: String,
  val title: String,
  val body: String,
  /** Set when the phone has more than one server, so the notification says which one it is. */
  val serverName: String?,
) {
  /** The notification data that the app reads, as `NotificationService.swift` gives it on iOS. */
  fun data(): JSONObject =
    JSONObject()
      .put("serverId", serverId)
      .put("agentId", agentId)
      .put("threadId", threadId ?: JSONObject.NULL)
      .put("kind", kind)
}

/**
 * Opens a notification that an OpenBot host sealed, with the keys of each server that the app writes
 * into `push-notifications.json` in its files folder (`android-push-notifications.android.ts`).
 *
 * The seal is the one of `live-activity-seal.ts` in `@openbot/team-client`: a keystream of
 * HMAC-SHA256 blocks over a 16-byte nonce and a 32-bit counter, then a 16-byte HMAC-SHA256 tag over
 * the nonce and the ciphertext, as base64url. `NotificationService.swift` opens it on iOS.
 */
internal object SealedNotification {
  private const val NONCE_BYTES = 16
  private const val TAG_BYTES = 16
  private const val BLOCK_BYTES = 32
  private const val KEYS_FILE = "push-notifications.json"

  private class ServerKeys(val serverId: String, val name: String, val seal: ByteArray, val tag: ByteArray)

  fun open(context: Context, sealed: String): OpenedNotification? {
    val servers = loadServers(context)
    val bytes = decodeBase64Url(sealed) ?: return null
    if (bytes.size <= NONCE_BYTES + TAG_BYTES) return null
    val body = bytes.copyOfRange(0, bytes.size - TAG_BYTES)
    val tag = bytes.copyOfRange(bytes.size - TAG_BYTES, bytes.size)
    val nonce = body.copyOfRange(0, NONCE_BYTES)
    val cipher = body.copyOfRange(NONCE_BYTES, body.size)
    for (server in servers) {
      val expected = hmac(server.tag, body).copyOf(TAG_BYTES)
      if (!MessageDigest.isEqual(expected, tag)) continue
      val plain = ByteArray(cipher.size)
      var offset = 0
      var counter = 0
      while (offset < cipher.size) {
        val stream = hmac(server.seal, nonce + ByteBuffer.allocate(4).putInt(counter).array())
        for (index in 0 until minOf(BLOCK_BYTES, cipher.size - offset)) {
          plain[offset + index] = (cipher[offset + index].toInt() xor stream[index].toInt()).toByte()
        }
        offset += BLOCK_BYTES
        counter += 1
      }
      val json = try {
        JSONObject(String(plain, Charsets.UTF_8))
      } catch (error: JSONException) {
        return null
      }
      // A host seals with the keys of its own server only, so it cannot speak for another one.
      if (json.opt("serverId") != server.serverId) return null
      val agentId = json.opt("agentId") as? String ?: return null
      val kind = json.opt("kind") as? String ?: return null
      val title = json.opt("title") as? String ?: return null
      val text = json.opt("body") as? String ?: return null
      return OpenedNotification(
        serverId = server.serverId,
        agentId = agentId,
        threadId = json.opt("threadId") as? String,
        kind = kind,
        title = title,
        body = text,
        serverName = if (servers.size > 1) server.name else null,
      )
    }
    return null
  }

  private fun loadServers(context: Context): List<ServerKeys> {
    val json = try {
      JSONObject(File(context.filesDir, KEYS_FILE).readText(Charsets.UTF_8))
    } catch (error: IOException) {
      return emptyList()
    } catch (error: JSONException) {
      return emptyList()
    }
    if ((json.opt("version") as? Number)?.toInt() != 1) return emptyList()
    val servers = json.opt("servers") as? JSONArray ?: return emptyList()
    return (0 until servers.length()).mapNotNull { index ->
      val server = servers.opt(index) as? JSONObject ?: return@mapNotNull null
      val serverId = server.opt("serverId") as? String ?: return@mapNotNull null
      val name = server.opt("name") as? String ?: return@mapNotNull null
      val seal = (server.opt("seal") as? String)?.let { decodeBase64Url(it) } ?: return@mapNotNull null
      val tag = (server.opt("tag") as? String)?.let { decodeBase64Url(it) } ?: return@mapNotNull null
      if (seal.isEmpty() || tag.isEmpty()) return@mapNotNull null
      ServerKeys(serverId, name, seal, tag)
    }
  }

  private fun hmac(key: ByteArray, data: ByteArray): ByteArray {
    val mac = Mac.getInstance("HmacSHA256")
    mac.init(SecretKeySpec(key, "HmacSHA256"))
    return mac.doFinal(data)
  }

  private fun decodeBase64Url(value: String): ByteArray? = try {
    Base64.decode(value, Base64.URL_SAFE or Base64.NO_PADDING or Base64.NO_WRAP)
  } catch (error: IllegalArgumentException) {
    null
  }
}
