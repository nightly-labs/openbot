import { Typography } from "heroui-native";
import { Component, type ErrorInfo, type ReactNode } from "react";
import { View } from "react-native";
import { supportLog, supportLogValue } from "@/features/support/model/support-log";
import { ChatBubbleHeader } from "../screens/chat-bubble-screen";

interface ChatBubbleErrorBoundaryProps {
  title: string;
  message: string;
  children: ReactNode;
}

interface ChatBubbleErrorBoundaryState {
  failed: boolean;
}

export class ChatBubbleErrorBoundary extends Component<ChatBubbleErrorBoundaryProps, ChatBubbleErrorBoundaryState> {
  override state: ChatBubbleErrorBoundaryState = { failed: false };

  static getDerivedStateFromError(): ChatBubbleErrorBoundaryState {
    return { failed: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    supportLog.add("error", "app", `Chat bubble failed: ${supportLogValue(error)} ${info.componentStack ?? ""}`);
  }

  override render(): ReactNode {
    if (!this.state.failed) return this.props.children;
    return (
      <View className="flex-1 bg-background">
        <ChatBubbleHeader title={this.props.title} />
        <Typography.Paragraph type="body-sm" className="px-4 text-muted">
          {this.props.message}
        </Typography.Paragraph>
      </View>
    );
  }
}
