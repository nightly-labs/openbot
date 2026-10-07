import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { initialRouteName: "index" };

export default function SectionFormLayout() {
  const { t } = useText();
  // The page sets its own title for a new or renamed section.
  return <SheetPageStack title={t("mobile.app.route.newSection")} />;
}
