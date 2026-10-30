package run.openbot.composerpaste

import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.provider.OpenableColumns
import android.view.View
import android.webkit.MimeTypeMap
import android.widget.EditText
import androidx.core.view.ContentInfoCompat
import androidx.core.view.OnReceiveContentListener
import androidx.core.view.ViewCompat
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.viewevent.EventDispatcher
import expo.modules.kotlin.views.ExpoView
import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.Executors

/** The types that a keyboard can insert as files. A paste of any clip goes to the listener. */
private val FILE_TYPES = arrayOf("image/*", "video/*", "audio/*", "application/*", "text/*", "message/*")

private val copier = Executors.newSingleThreadExecutor()

/**
 * Wraps the chat composer field. The React Native field pastes text only, so a paste or keyboard
 * insert of photos, videos or other files in it is copied to the cache and sent to JavaScript.
 */
class ComposerPasteView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPasteFiles by EventDispatcher()

  /** The largest file that the app attaches. The copy thread reads it. */
  @Volatile var maxBytes = Long.MAX_VALUE - 1

  private val receiver = OnReceiveContentListener { _, payload ->
    // A clip item with a content address is a file. Text, and a link as text, stay for the field.
    val split = payload.partition { item -> item.uri?.scheme == ContentResolver.SCHEME_CONTENT }
    split.first?.let { copyFiles(it) }
    split.second
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(View.MeasureSpec.getSize(widthMeasureSpec), View.MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  override fun onViewAdded(child: View) {
    super.onViewAdded(child)
    if (child is EditText) ViewCompat.setOnReceiveContentListener(child, FILE_TYPES, receiver)
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child is EditText) ViewCompat.setOnReceiveContentListener(child, null, null)
  }

  private fun copyFiles(files: ContentInfoCompat) {
    val clip = files.clip
    val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    // The address can stop working when the keyboard or the clip changes, so the copy starts now.
    copier.execute {
      val copied = uris.mapNotNull { uri -> runCatching { copyFile(uri) }.getOrNull() }
      post { onPasteFiles(mapOf("files" to copied, "failed" to uris.size - copied.size)) }
    }
  }

  private fun copyFile(uri: Uri): Map<String, String> {
    val resolver = context.contentResolver
    val extension = resolver.getType(uri)?.let { MimeTypeMap.getSingleton().getExtensionFromMimeType(it) }
    val suffix = extension?.let { ".$it" } ?: ""
    val shown = displayName(resolver, uri)?.replace('/', '_')?.trim().orEmpty()
    val name = when {
      shown.isEmpty() -> "pasted-file$suffix"
      shown.contains('.') || extension == null -> shown
      else -> "$shown$suffix"
    }
    val target = File(context.cacheDir, "openbot-paste-${UUID.randomUUID()}$suffix")
    val input = resolver.openInputStream(uri) ?: error("The pasted file cannot be read.")
    try {
      // One byte over the limit is enough for JavaScript to refuse the file with its name.
      input.use { source -> target.outputStream().use { sink -> copyAtMost(source, sink, maxBytes + 1) } }
    } catch (error: Exception) {
      target.delete()
      throw error
    }
    return mapOf("uri" to Uri.fromFile(target).toString(), "name" to name)
  }

  private fun copyAtMost(source: InputStream, sink: OutputStream, limit: Long) {
    val buffer = ByteArray(DEFAULT_BUFFER_SIZE)
    var left = limit
    while (left > 0) {
      val read = source.read(buffer, 0, minOf(buffer.size.toLong(), left).toInt())
      if (read < 0) return
      sink.write(buffer, 0, read)
      left -= read
    }
  }

  private fun displayName(resolver: ContentResolver, uri: Uri): String? =
    resolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use { cursor ->
      if (cursor.moveToFirst()) cursor.getString(0) else null
    }
}

class ComposerPasteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenBotComposerPaste")

    View(ComposerPasteView::class) {
      Events("onPasteFiles")

      Prop("maxBytes") { view: ComposerPasteView, maxBytes: Int ->
        view.maxBytes = maxBytes.toLong()
      }
    }
  }
}
