import { requireOptionalNativeModule } from "expo";

export default requireOptionalNativeModule("ExpoTopicSubscriptionModule") ?? {};
