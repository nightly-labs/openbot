package run.openbot.applock

import android.app.Activity
import android.app.Application
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.SystemClock
import androidx.core.content.ContextCompat
import expo.modules.kotlin.functions.Queues
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import javax.crypto.Mac
import javax.crypto.spec.SecretKeySpec

class AwayState : Record {
  /** The time since the app went to the background, or null when it did not go there. */
  @Field var awayMs: Double? = null

  /** True when the screen turned off since the last read. */
  @Field var phoneLocked: Boolean = false
}

/**
 * Measures the time that the app is away. The app is away when no activity of it shows, so a system
 * dialog over it, such as a permission or fingerprint prompt, does not count. The clock counts while
 * the phone sleeps, and a change of the phone's time does not move it. All calls run on the main thread.
 */
class AppLockModule : Module() {
  private var enabled = false
  private var watchPhoneLock = false
  private var awaySince: Long? = null
  private var phoneLocked = false
  private val started = mutableSetOf<Int>()
  private var callbacks: Application.ActivityLifecycleCallbacks? = null
  private var screenReceiver: BroadcastReceiver? = null

  override fun definition() = ModuleDefinition {
    Name("OpenBotAppLock")

    /** Starts or stops the signals. */
    AsyncFunction("configure") { enabled: Boolean, watchPhoneLock: Boolean ->
      configure(enabled, watchPhoneLock)
    }.runOnQueue(Queues.MAIN)

    /** Returns the time away and the screen lock since the last read, and clears them. */
    AsyncFunction("takeAway") {
      val state = AwayState()
      state.awayMs = awaySince?.let { (SystemClock.elapsedRealtime() - it).toDouble() }
      state.phoneLocked = phoneLocked
      awaySince = null
      phoneLocked = false
      state
    }.runOnQueue(Queues.MAIN)

    /** Runs on a background thread, so the hash does not stop the interface. */
    AsyncFunction("derivePin") { pin: String, saltHex: String, iterations: Int ->
      derivePin(pin, saltHex, iterations)
    }

    OnDestroy {
      val application = appContext.reactContext?.applicationContext as? Application
      callbacks?.let { application?.unregisterActivityLifecycleCallbacks(it) }
      callbacks = null
      setScreenReceiver(false)
    }
  }

  private fun configure(enabled: Boolean, watchPhoneLock: Boolean) {
    this.enabled = enabled
    this.watchPhoneLock = enabled && watchPhoneLock
    if (!enabled) {
      awaySince = null
      phoneLocked = false
    }
    if (enabled && callbacks == null) listen()
    setScreenReceiver(this.watchPhoneLock)
    appContext.currentActivity?.let { hideFromRecents(it) }
  }

  private fun listen() {
    val application = appContext.reactContext?.applicationContext as? Application ?: return
    // The app is in the foreground when JavaScript turns the lock on.
    appContext.currentActivity?.let { started.add(System.identityHashCode(it)) }
    val next = object : Application.ActivityLifecycleCallbacks {
      override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = hideFromRecents(activity)

      override fun onActivityStarted(activity: Activity) {
        started.add(System.identityHashCode(activity))
      }

      override fun onActivityResumed(activity: Activity) = Unit

      override fun onActivityPaused(activity: Activity) = Unit

      override fun onActivityStopped(activity: Activity) {
        started.remove(System.identityHashCode(activity))
        if (enabled && started.isEmpty() && !activity.isChangingConfigurations && awaySince == null) {
          awaySince = SystemClock.elapsedRealtime()
        }
      }

      override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit

      override fun onActivityDestroyed(activity: Activity) {
        started.remove(System.identityHashCode(activity))
      }
    }
    application.registerActivityLifecycleCallbacks(next)
    callbacks = next
  }

  /** The screen turns off when the phone locks. Android sends this to a running app only. */
  private fun setScreenReceiver(on: Boolean) {
    val context = appContext.reactContext?.applicationContext ?: return
    if (on && screenReceiver == null) {
      val receiver = object : BroadcastReceiver() {
        override fun onReceive(context: Context, intent: Intent) {
          if (intent.action == Intent.ACTION_SCREEN_OFF && enabled) phoneLocked = true
        }
      }
      ContextCompat.registerReceiver(
        context,
        receiver,
        IntentFilter(Intent.ACTION_SCREEN_OFF),
        ContextCompat.RECEIVER_NOT_EXPORTED,
      )
      screenReceiver = receiver
    } else if (!on && screenReceiver != null) {
      runCatching { context.unregisterReceiver(screenReceiver) }
      screenReceiver = null
    }
  }

  /** Android 13 and later show a blank card in the recent apps, so the screenshot does not show a chat. */
  private fun hideFromRecents(activity: Activity) {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) activity.setRecentsScreenshotEnabled(!enabled)
  }
}

/**
 * PBKDF2-HMAC-SHA256 with a 32-byte result, as lowercase hex. JavaScript takes seconds for the same work.
 * Android adds `PBKDF2WithHmacSHA256` only in API 26, so this uses HMAC directly. One block gives 32 bytes.
 */
private fun derivePin(pin: String, saltHex: String, iterations: Int): String {
  require(pin.isNotEmpty() && iterations > 0 && saltHex.isNotEmpty() && saltHex.length % 2 == 0)
  val salt = ByteArray(saltHex.length / 2) { saltHex.substring(it * 2, it * 2 + 2).toInt(16).toByte() }
  val mac = Mac.getInstance("HmacSHA256")
  mac.init(SecretKeySpec(pin.toByteArray(Charsets.UTF_8), "HmacSHA256"))
  mac.update(salt)
  var block = mac.doFinal(byteArrayOf(0, 0, 0, 1))
  val key = block.copyOf()
  repeat(iterations - 1) {
    block = mac.doFinal(block)
    for (index in key.indices) key[index] = (key[index].toInt() xor block[index].toInt()).toByte()
  }
  return key.joinToString("") { (it.toInt() and 0xff).toString(16).padStart(2, '0') }
}
