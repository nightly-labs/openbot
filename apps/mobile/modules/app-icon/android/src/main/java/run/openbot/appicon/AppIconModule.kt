package run.openbot.appicon

import android.app.Activity
import android.app.Application
import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Bundle
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ALIAS_PREFIX = "AppIcon"

class UnknownIconException(id: String) : CodedException("The app has no icon \"$id\"")

class AppIconModule : Module() {
  private var pending: String? = null
  private val started = mutableSetOf<Int>()
  private var callbacks: Application.ActivityLifecycleCallbacks? = null

  override fun definition() = ModuleDefinition {
    Name("OpenBotAppIcon")

    AsyncFunction("getIcon") {
      val context = context() ?: return@AsyncFunction null
      pending ?: current(context)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setIcon") { id: String ->
      val context = context() ?: throw UnknownIconException(id)
      if (!aliases(context).containsKey(id)) throw UnknownIconException(id)
      pending = if (id == current(context)) null else id
      if (pending != null) listen(context)
    }.runOnQueue(Queues.MAIN)

    OnDestroy {
      val application = context() as? Application
      callbacks?.let { application?.unregisterActivityLifecycleCallbacks(it) }
      callbacks = null
    }
  }

  private fun listen(context: Context) {
    if (callbacks != null) return
    val application = context as? Application ?: return
    appContext.currentActivity?.let { started.add(System.identityHashCode(it)) }
    val next = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit

      override fun onActivityStarted(activity: Activity) {
        started.add(System.identityHashCode(activity))
      }

      override fun onActivityResumed(activity: Activity) = Unit

      override fun onActivityPaused(activity: Activity) = Unit

      override fun onActivityStopped(activity: Activity) {
        started.remove(System.identityHashCode(activity))
        if (started.isEmpty() && !activity.isChangingConfigurations) applyPending()
      }

      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

      override fun onActivityDestroyed(activity: Activity) = Unit
    }
    application.registerActivityLifecycleCallbacks(next)
    callbacks = next
  }

  private fun applyPending() {
    val id = pending ?: return
    pending = null
    context()?.let { apply(it, id) }
  }

  private fun context(): Context? = appContext.reactContext?.applicationContext

  private fun aliases(context: Context): Map<String, ComponentName> {
    val intent = Intent(Intent.ACTION_MAIN).addCategory(Intent.CATEGORY_LAUNCHER).setPackage(context.packageName)
    @Suppress("DEPRECATION")
    val activities = context.packageManager.queryIntentActivities(intent, PackageManager.MATCH_DISABLED_COMPONENTS)
    return activities
      .mapNotNull { resolved ->
        val name = resolved.activityInfo?.name ?: return@mapNotNull null
        val simple = name.substringAfterLast('.')
        if (!simple.startsWith(ALIAS_PREFIX) || simple.length == ALIAS_PREFIX.length) return@mapNotNull null
        simple.removePrefix(ALIAS_PREFIX).replaceFirstChar { it.lowercase() } to ComponentName(context.packageName, name)
      }
      .toMap()
  }

  private fun enabled(context: Context, component: ComponentName): Boolean =
    when (context.packageManager.getComponentEnabledSetting(component)) {
      PackageManager.COMPONENT_ENABLED_STATE_ENABLED -> true
      PackageManager.COMPONENT_ENABLED_STATE_DEFAULT ->
        try {
          @Suppress("DEPRECATION")
          context.packageManager.getActivityInfo(component, PackageManager.MATCH_DISABLED_COMPONENTS).enabled
        } catch (error: PackageManager.NameNotFoundException) {
          false
        }
      else -> false
    }

  private fun current(context: Context): String? = aliases(context).entries.firstOrNull { enabled(context, it.value) }?.key

  private fun apply(context: Context, id: String) {
    val aliases = aliases(context)
    val next = aliases[id] ?: return
    val manager = context.packageManager
    manager.setComponentEnabledSetting(next, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
    for ((other, component) in aliases) {
      if (other == id) continue
      manager.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
  }
}
