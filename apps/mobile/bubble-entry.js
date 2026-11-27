import "expo-router/entry";

import { AppRegistry } from "react-native";

import { ChatBubbleApp } from "./src/features/chat-bubble/screens/chat-bubble-app";

AppRegistry.registerComponent("chat-bubble", () => ChatBubbleApp);
