import { Typography } from "heroui-native";
import { View } from "react-native";

export function SignInSteps({ steps }: { steps: readonly string[] }) {
  return (
    <View className="gap-3 px-4 py-3">
      {steps.map((step, index) => (
        <View key={step} className="flex-row gap-3">
          <View className="size-6 items-center justify-center rounded-full bg-control">
            <Typography.Paragraph type="body-xs">{index + 1}</Typography.Paragraph>
          </View>
          <Typography.Paragraph className="min-w-0 flex-1">{step}</Typography.Paragraph>
        </View>
      ))}
    </View>
  );
}
