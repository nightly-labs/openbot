package run.openbot.contentcapture

import android.app.Activity
import android.content.Context
import android.os.Build
import android.os.Bundle
import android.view.contentcapture.ContentCaptureManager
import expo.modules.core.interfaces.Package
import expo.modules.core.interfaces.ReactActivityLifecycleListener

class ContentCapturePackage : Package {
  override fun createReactActivityLifecycleListeners(activityContext: Context?): List<ReactActivityLifecycleListener> =
    listOf(ContentCaptureOptOut)
}

private object ContentCaptureOptOut : ReactActivityLifecycleListener {
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) = disableContentCapture(activity)

  override fun onResume(activity: Activity?) = disableContentCapture(activity)
}

private fun disableContentCapture(activity: Activity?) {
  if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
  activity.getSystemService(ContentCaptureManager::class.java)?.setContentCaptureEnabled(false)
}
