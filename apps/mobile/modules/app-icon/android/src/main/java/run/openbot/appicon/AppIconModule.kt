package run.openbot.appicon

import android.content.ComponentName
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import expo.modules.kotlin.exception.CodedException
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

private const val ALIAS_PREFIX = "AppIcon"

class UnknownIconException(id: String) : CodedException("The app has no icon \"$id\"")

/**
 * The app icon of the launcher. `plugins/with-app-icons.js` gives `MainActivity` one launcher alias
 * for each variant of `assets/icons/app-icon-variants.json`, such as `.AppIconMidnight`, and the
 * launcher shows the enabled alias. Some launchers close the app when its launcher activity changes,
 * so the change waits until the app goes to the background. All calls run on the main thread.
 */
class AppIconModule : Module() {
  private var pending: String? = null

  override fun definition() = ModuleDefinition {
    Name("OpenBotAppIcon")

    /** The ID of the selected variant, also when it waits for the background. */
    AsyncFunction("getIcon") {
      val context = context() ?: return@AsyncFunction null
      pending ?: current(context)
    }.runOnQueue(Queues.MAIN)

    AsyncFunction("setIcon") { id: String ->
      val context = context() ?: throw UnknownIconException(id)
      if (!aliases(context).containsKey(id)) throw UnknownIconException(id)
      pending = if (id == current(context)) null else id
    }.runOnQueue(Queues.MAIN)

    OnActivityEntersBackground {
      val id = pending ?: return@OnActivityEntersBackground
      pending = null
      context()?.let { apply(it, id) }
    }
  }

  private fun context(): Context? = appContext.reactContext?.applicationContext

  /** The launcher aliases by variant ID, with the disabled ones. */
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
    // The new alias comes first, so the app always has a launcher entry.
    manager.setComponentEnabledSetting(next, PackageManager.COMPONENT_ENABLED_STATE_ENABLED, PackageManager.DONT_KILL_APP)
    for ((other, component) in aliases) {
      if (other == id) continue
      manager.setComponentEnabledSetting(component, PackageManager.COMPONENT_ENABLED_STATE_DISABLED, PackageManager.DONT_KILL_APP)
    }
  }
}
