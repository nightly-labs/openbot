import { useThemeColor } from "heroui-native/hooks";
import { useText } from "@/shared/lib/text";
import { DOM_OPTIONS, type DocumentPreviewProps, PreviewMessage, useFileBase64 } from "./file-document-preview";
import PdfPages from "./pdf-pages.dom";

export function PdfPreview({ uri, title, insets }: DocumentPreviewProps) {
  const { t } = useText();
  const [background, muted] = useThemeColor(["background", "muted"]);
  const base64 = useFileBase64(uri);
  if (base64.error) return <PreviewMessage text={t("mobile.chat.preview.pdfFailed")} />;
  if (base64.value === null) return <PreviewMessage text={t("common.loading")} />;
  return (
    <PdfPages
      base64={base64.value}
      title={title}
      insets={insets}
      background={String(background)}
      muted={String(muted)}
      failedText={t("mobile.chat.preview.pdfFailed")}
      dom={DOM_OPTIONS}
    />
  );
}
