package run.openbot.themesnapshot

import android.graphics.Bitmap
import android.os.Build
import android.os.Handler
import android.os.HandlerThread
import android.view.PixelCopy
import expo.modules.kotlin.Promise
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.ByteArrayOutputStream

class ThemeSnapshotException : CodedException("The window has no picture")

/**
 * A picture of the activity window, with the sheets that React Native Screens draws in it. The theme
 * change (`src/features/settings/components/theme-sweep.tsx`) shows it as the old theme while the new
 * one comes in under it. `PixelCopy` copies the pixels on screen. A redraw of the views, as Skia's
 * `makeImageFromView` does, misses the sheet's offset and some text padding. The picture goes to
 * JavaScript as JPEG bytes. The copy and the JPEG run on a background thread.
 */
class ThemeSnapshotModule : Module() {
  private var worker: HandlerThread? = null

  override fun definition() = ModuleDefinition {
    Name("OpenBotThemeSnapshot")

    AsyncFunction("snapshot") { promise: Promise ->
      val window = appContext.currentActivity?.window
      val view = window?.decorView
      if (window == null || view == null || view.width <= 0 || view.height <= 0 ||
        Build.VERSION.SDK_INT < Build.VERSION_CODES.O
      ) {
        promise.reject(ThemeSnapshotException())
        return@AsyncFunction
      }
      val bitmap = Bitmap.createBitmap(view.width, view.height, Bitmap.Config.ARGB_8888)
      val thread = worker ?: HandlerThread("OpenBotThemeSnapshot").apply { start() }.also { worker = it }
      val handler = Handler(thread.looper)
      PixelCopy.request(window, bitmap, { result ->
        if (result != PixelCopy.SUCCESS) {
          bitmap.recycle()
          promise.reject(ThemeSnapshotException())
          return@request
        }
        val output = ByteArrayOutputStream()
        bitmap.compress(Bitmap.CompressFormat.JPEG, 92, output)
        bitmap.recycle()
        promise.resolve(output.toByteArray())
      }, handler)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      worker?.quitSafely()
      worker = null
    }
  }
}
