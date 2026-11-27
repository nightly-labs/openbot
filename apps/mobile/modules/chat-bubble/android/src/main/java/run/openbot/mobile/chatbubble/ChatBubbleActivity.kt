package run.openbot.mobile.chatbubble

import android.os.Bundle
import com.facebook.react.ReactActivity
import com.facebook.react.ReactActivityDelegate
import com.facebook.react.defaults.DefaultReactActivityDelegate
import expo.modules.ReactActivityDelegateWrapper

/**
 * The expanded bubble. It hosts the second React Native root that `bubble-entry.js` registers as
 * `chat-bubble`, so the bubble shows a chat without the screens of the app.
 */
class ChatBubbleActivity : ReactActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(null)
  }

  override fun getMainComponentName(): String = "chat-bubble"

  override fun createReactActivityDelegate(): ReactActivityDelegate =
    ReactActivityDelegateWrapper(this, DefaultReactActivityDelegate(this, mainComponentName))
}
