package run.openbot.sharefiles

import android.content.ClipData
import android.content.Intent
import android.net.Uri
import androidx.core.content.FileProvider
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File

class NoFilesException : CodedException("No files to share")

/** One share sheet with many files. `expo-sharing` takes one file only. */
class ShareFilesModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenBotShareFiles")

    AsyncFunction("shareAsync") { urls: List<String>, mimeType: String ->
      if (urls.isEmpty()) throw NoFilesException()
      val activity = appContext.throwingActivity
      // The provider that expo-sharing declares. It serves the app's cache folder.
      val authority = activity.applicationInfo.packageName + ".SharingFileProvider"
      val uris = ArrayList(
        urls.map { url ->
          val path = Uri.parse(url).path ?: throw NoFilesException()
          FileProvider.getUriForFile(activity, authority, File(path))
        }
      )
      val clip = ClipData.newRawUri(null, uris.first())
      uris.drop(1).forEach { clip.addItem(ClipData.Item(it)) }
      val send = Intent(Intent.ACTION_SEND_MULTIPLE).apply {
        type = mimeType
        putParcelableArrayListExtra(Intent.EXTRA_STREAM, uris)
        clipData = clip
        addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
      }
      activity.startActivity(Intent.createChooser(send, null))
    }
  }
}
