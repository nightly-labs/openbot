import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

export default function NewTaskLayout() {
  const { t } = useText();
  return <SheetPageStack title={t("mobile.server.threads.new")} />;
}
