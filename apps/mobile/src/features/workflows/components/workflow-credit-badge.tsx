import { Typography } from "heroui-native";
import { View } from "react-native";
import { useCSSVariable } from "uniwind";
import { CreditStar } from "@/features/settings/components/credit-star";
import type { NodeCredits } from "@/features/workflows/model/use-media-credits";
import { useText } from "@/shared/lib/text";
import { typeScale } from "@/shared/lib/type-scale";

export function CreditBadge({ credits, short }: NodeCredits) {
  const { t, format } = useText();
  const danger = String(useCSSVariable("--openbot-danger-text"));
  const label = t("mobile.workflow.media.credits", { count: credits, amount: format.number(credits) });
  return (
    <View
      accessible
      accessibilityLabel={t("mobile.workflow.media.badge", { credits: label })}
      className="flex-row items-center gap-1 self-start rounded-full bg-control px-2 py-0.5"
    >
      <CreditStar size={12} color={short ? danger : undefined} />
      <Typography.Paragraph
        className={short ? "font-medium text-danger-text" : "text-grouped-secondary"}
        style={typeScale.small}
      >
        {label}
      </Typography.Paragraph>
    </View>
  );
}
