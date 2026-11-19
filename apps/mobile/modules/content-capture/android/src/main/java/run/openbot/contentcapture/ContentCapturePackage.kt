package run.openbot.contentcapture

import android.annotation.TargetApi
import android.app.Activity
import android.app.Application
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
  override fun onCreate(activity: Activity?, savedInstanceState: Bundle?) {
    if (activity == null || Build.VERSION.SDK_INT < Build.VERSION_CODES.Q) return
    disableContentCapture(activity)
    activity.registerActivityLifecycleCallbacks(DisableBeforeWindowAttaches)
  }
}

@TargetApi(Build.VERSION_CODES.Q)
private object DisableBeforeWindowAttaches : Application.ActivityLifecycleCallbacks {
  override fun onActivityPreResumed(activity: Activity) = disableContentCapture(activity)

  override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

  override fun onActivityStarted(activity: Activity) = Unit

  override fun onActivityResumed(activity: Activity) = Unit

  override fun onActivityPaused(activity: Activity) = Unit

  override fun onActivityStopped(activity: Activity) = Unit

  override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

  override fun onActivityDestroyed(activity: Activity) = Unit
}

@TargetApi(Build.VERSION_CODES.Q)
private fun disableContentCapture(activity: Activity) {
  activity.getSystemService(ContentCaptureManager::class.java)?.setContentCaptureEnabled(false)
}
