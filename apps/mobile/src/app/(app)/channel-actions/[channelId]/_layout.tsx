import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function ChannelActionsLayout() {
  const { t } = useText();
  // The list starts below the header, so the header is opaque on iOS too.
  return <SheetPageStack title={t("mobile.app.route.actionsNeeded")} opaqueHeader />;
}
