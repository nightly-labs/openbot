import { requireOptionalNativeModule } from "expo";

// The topic module of expo-notifications on Android. Expo Go on Android has no remote notifications
// since SDK 53, so it has no `ExpoTopicSubscriptionModule`, and the package loads it as a required
// module: the app then stops at its first import of expo-notifications. A development or store build
// has the module, and this gives the same module. In Expo Go, the topic functions are missing, and
// expo-notifications then rejects a topic call with its own `UnavailabilityError`. The app does not
// use topics.
export default requireOptionalNativeModule("ExpoTopicSubscriptionModule") ?? {};
