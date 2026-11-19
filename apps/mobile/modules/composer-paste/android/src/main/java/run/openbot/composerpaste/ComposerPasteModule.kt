package run.openbot.composerpaste

import android.content.ClipDescription
import android.content.ContentResolver
import android.content.Context
import android.net.Uri
import android.os.Handler
import android.os.Looper
import android.provider.OpenableColumns
import android.view.DragEvent
import android.view.KeyEvent
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

private val FILE_TYPES = arrayOf("image/*", "video/*", "audio/*", "application/*", "text/*", "message/*")

private val copier = Executors.newSingleThreadExecutor()

class ComposerPasteView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onPasteFiles by EventDispatcher()
  private val onSubmitKey by EventDispatcher()

  private val submitKey = View.OnKeyListener { field, keyCode, event ->
    if (!isSubmitKey(keyCode, event) || field !is EditText || !field.isEnabled) return@OnKeyListener false
    if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
      onSubmitKey(mapOf("text" to field.text.toString()))
    }
    true
  }

  @Volatile var maxBytes = Long.MAX_VALUE - 1

  private val receiver = OnReceiveContentListener { _, payload ->
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
    if (child is EditText) {
      ViewCompat.setOnReceiveContentListener(child, FILE_TYPES, receiver)
      child.setOnKeyListener(submitKey)
    }
  }

  override fun onViewRemoved(child: View) {
    super.onViewRemoved(child)
    if (child is EditText) {
      ViewCompat.setOnReceiveContentListener(child, null, null)
      child.setOnKeyListener(null)
    }
  }

  private fun isSubmitKey(keyCode: Int, event: KeyEvent): Boolean {
    if (keyCode != KeyEvent.KEYCODE_ENTER && keyCode != KeyEvent.KEYCODE_NUMPAD_ENTER) return false
    if ((event.flags and KeyEvent.FLAG_SOFT_KEYBOARD) != 0 || event.device?.isVirtual != false) return false
    val modifiers = event.modifiers and KeyEvent.META_CTRL_MASK.inv()
    return KeyEvent.metaStateHasNoModifiers(modifiers)
  }

  private fun copyFiles(files: ContentInfoCompat) {
    val clip = files.clip
    val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
    copyUris(this, uris, maxBytes) { onPasteFiles(it) }
  }
}

class ChatDropView(context: Context, appContext: AppContext) : ExpoView(context, appContext) {
  private val onDropFiles by EventDispatcher()

  @Volatile var maxBytes = Long.MAX_VALUE - 1
  var dropEnabled = true

  init {
    setOnDragListener { _, event ->
      when (event.action) {
        DragEvent.ACTION_DRAG_STARTED -> dropEnabled && hasFile(event.clipDescription)
        DragEvent.ACTION_DROP -> dropEnabled && drop(event)
        else -> true
      }
    }
  }

  override fun onMeasure(widthMeasureSpec: Int, heightMeasureSpec: Int) {
    setMeasuredDimension(View.MeasureSpec.getSize(widthMeasureSpec), View.MeasureSpec.getSize(heightMeasureSpec))
  }

  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) = Unit

  private fun hasFile(description: ClipDescription?): Boolean =
    description != null && FILE_TYPES.any { description.hasMimeType(it) }

  private fun drop(event: DragEvent): Boolean {
    val clip = event.clipData ?: return false
    val permissions = appContext.currentActivity?.requestDragAndDropPermissions(event)
    val uris = (0 until clip.itemCount).mapNotNull { clip.getItemAt(it).uri }
      .filter { it.scheme == ContentResolver.SCHEME_CONTENT }
    if (uris.isEmpty()) {
      permissions?.release()
      return false
    }
    copyUris(this, uris, maxBytes) { result ->
      permissions?.release()
      onDropFiles(result)
    }
    return true
  }
}

private val mainThread = Handler(Looper.getMainLooper())

private fun copyUris(view: View, uris: List<Uri>, maxBytes: Long, done: (Map<String, Any>) -> Unit) {
  val context = view.context
  copier.execute {
    val copied = uris.mapNotNull { uri -> runCatching { copyFile(context, uri, maxBytes) }.getOrNull() }
    mainThread.post { done(mapOf("files" to copied, "failed" to uris.size - copied.size)) }
  }
}

private fun copyFile(context: Context, uri: Uri, maxBytes: Long): Map<String, String> {
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

class ComposerPasteModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("OpenBotComposerPaste")

    Constant("chatDrop") { true }

    View(ComposerPasteView::class) {
      Events("onPasteFiles", "onSubmitKey")

      Prop("maxBytes") { view: ComposerPasteView, maxBytes: Int ->
        view.maxBytes = maxBytes.toLong()
      }
    }

    View(ChatDropView::class) {
      Name("ChatDrop")
      Events("onDropFiles")

      Prop("maxBytes") { view: ChatDropView, maxBytes: Int ->
        view.maxBytes = maxBytes.toLong()
      }

      Prop("enabled") { view: ChatDropView, enabled: Boolean ->
        view.dropEnabled = enabled
      }
    }
  }
}
