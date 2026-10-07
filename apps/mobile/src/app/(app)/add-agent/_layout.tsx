import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function AddAgentLayout() {
  const { t } = useText();
  return <SheetPageStack title={t("mobile.app.route.createAgent")} />;
}
