package run.openbot.quickactions

import android.content.ComponentName
import android.content.Intent
import android.content.pm.PackageManager
import android.content.pm.ShortcutInfo
import android.content.pm.ShortcutManager
import android.graphics.drawable.Icon
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record

private const val QUICK_ACTION_EVENT = "onQuickAction"
private const val SHORTCUT_ACTION = "run.openbot.mobile.QUICK_ACTION"
private const val SHORTCUT_ID = "run.openbot.mobile.QUICK_ACTION_ID"

class QuickActionItem : Record {
  @Field val id: String = ""
  @Field val title: String = ""
  @Field val icon: String = ""
}

/**
 * The app shortcuts of the launcher icon. A shortcut starts the main activity with its ID, and the
 * module holds the ID until JavaScript listens.
 */
class QuickActionsModule : Module() {
  private val lock = Any()
  private var listening = false
  private var pending: String? = null

  /** The last items, so the shortcuts come back when the launcher activity changes. */
  @Volatile private var items: List<QuickActionItem> = emptyList()

  override fun definition() = ModuleDefinition {
    Name("OpenBotQuickActions")

    Events(QUICK_ACTION_EVENT)

    /** Replaces the dynamic shortcuts. Returns false when Android keeps the old ones. */
    AsyncFunction("setItems") { items: List<QuickActionItem> ->
      this@QuickActionsModule.items = items
      publish(items)
    }

    OnStartObserving {
      synchronized(lock) { listening = true }
      // A shortcut that starts the app is the intent of the activity.
      receive(appContext.currentActivity?.intent)
    }

    OnStopObserving {
      synchronized(lock) { listening = false }
    }

    // JavaScript can listen before the activity is current, so the activity reads its intent again here.
    OnActivityEntersForeground {
      receive(appContext.currentActivity?.intent)
      restore()
    }

    OnNewIntent { intent ->
      receive(intent)
    }
  }

  private fun receive(intent: Intent?) {
    val id = synchronized(lock) {
      takeId(intent)?.let { pending = it }
      if (!listening) return
      pending.also { pending = null }
    } ?: return
    sendEvent(QUICK_ACTION_EVENT, mapOf("id" to id))
  }

  private fun takeId(intent: Intent?): String? {
    if (intent == null || intent.action != SHORTCUT_ACTION) return null
    // Recents starts the task again with its first intent. That shortcut is old.
    if ((intent.flags and Intent.FLAG_ACTIVITY_LAUNCHED_FROM_HISTORY) != 0) return null
    val id = intent.getStringExtra(SHORTCUT_ID) ?: return null
    // The activity keeps its intent, so a later listener must not get the same shortcut again.
    intent.removeExtra(SHORTCUT_ID)
    return id
  }

  /**
   * Android removes the shortcuts of a launcher activity that the app disables, as when the user
   * selects another app icon (`modules/app-icon`). It can do so after the app is back, so the check
   * compares the activity of the shortcuts with the current launcher activity, not only the count.
   * After a restart, JavaScript publishes the items again.
   */
  private fun restore() {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1 || items.isEmpty()) return
    val context = appContext.reactContext ?: return
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return
    val launcher = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component ?: return
    val shortcuts = manager.dynamicShortcuts
    if (shortcuts.isEmpty() || shortcuts.any { it.activity != launcher }) publish(items)
  }

  private fun publish(items: List<QuickActionItem>): Boolean {
    if (Build.VERSION.SDK_INT < Build.VERSION_CODES.N_MR1) return false
    val context = appContext.reactContext ?: return false
    val manager = context.getSystemService(ShortcutManager::class.java) ?: return false
    val launcher = context.packageManager.getLaunchIntentForPackage(context.packageName)?.component ?: return false
    // The launcher entry is an alias of the main activity. A pinned shortcut opens the main activity
    // itself, so it still works when the user selects another app icon.
    val activity = try {
      context.packageManager.getActivityInfo(launcher, 0).targetActivity?.let { ComponentName(context.packageName, it) }
    } catch (error: PackageManager.NameNotFoundException) {
      null
    } ?: launcher
    val shortcuts = items.take(manager.maxShortcutCountPerActivity).mapIndexed { rank, item ->
      val intent = Intent(SHORTCUT_ACTION)
        .setComponent(activity)
        .putExtra(SHORTCUT_ID, item.id)
        // A running app keeps its screens and gets the shortcut in onNewIntent.
        .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
      ShortcutInfo.Builder(context, item.id)
        .setShortLabel(item.title)
        .setLongLabel(item.title)
        .setIcon(Icon.createWithResource(context, iconResource(item.icon)))
        .setIntent(intent)
        // The launcher entry that shows the shortcut: the alias of the selected app icon.
        .setActivity(launcher)
        .setRank(rank)
        .build()
    }
    return try {
      // Pinned copies with the same ID take the new title too.
      manager.setDynamicShortcuts(shortcuts)
    } catch (error: IllegalStateException) {
      // Android refuses the change while the user is locked.
      false
    }
  }

  private fun iconResource(icon: String): Int =
    when (icon) {
      "routines" -> R.drawable.openbot_quick_action_routines
      "search" -> R.drawable.openbot_quick_action_search
      else -> R.drawable.openbot_quick_action_agent
    }
}
