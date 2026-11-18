import { SheetPageStack } from "@/shared/components/sheet-page-stack";
import { useText } from "@/shared/lib/text";

export const unstable_settings = { anchor: "index" };

/** Add a step: a sheet over the editor, with its own header, which Android draws only inside a stack. */
export default function WorkflowAddStepLayout() {
  const { t } = useText();
  return <SheetPageStack title={t("mobile.workflow.add.title")} />;
}
