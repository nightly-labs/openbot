import { SPREADSHEET_MAX_COLUMNS, SPREADSHEET_MAX_ROWS } from "@openbot/contracts/spreadsheet-workbook";
import { File } from "expo-file-system";
import { Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import { useEffect, useState } from "react";
import { View } from "react-native";
import { expoGoDomOptions } from "@/shared/lib/expo-go-dom";
import { useText } from "@/shared/lib/text";
import SpreadsheetPreview from "./spreadsheet-preview.dom";

export interface DocumentPreviewProps {
  uri: string;
  title: string;
  /** The space that the floating header and the home indicator cover. */
  insets: { top: number; bottom: number };
}

export const DOM_OPTIONS = {
  ...expoGoDomOptions,
  style: { flex: 1 },
  containerStyle: { flex: 1 },
  scrollEnabled: false,
};

/** An `.xlsx` file as tables, one for each sheet. */
export function SpreadsheetFilePreview({ uri, title, insets }: DocumentPreviewProps) {
  const { t, format } = useText();
  const [background, foreground, muted, border, field] = useThemeColor([
    "background",
    "foreground",
    "muted",
    "border",
    "default",
  ]);
  const base64 = useFileBase64(uri);
  if (base64.error) return <PreviewMessage text={t("mobile.chat.preview.spreadsheetFailed")} />;
  if (base64.value === null) return <PreviewMessage text={t("common.loading")} />;
  return (
    <SpreadsheetPreview
      base64={base64.value}
      title={title}
      locale={format.locale}
      insets={insets}
      colors={{
        background: String(background),
        foreground: String(foreground),
        muted: String(muted),
        border: String(border),
        field: String(field),
      }}
      failedText={t("mobile.chat.preview.spreadsheetFailed")}
      truncatedText={t("mobile.chat.preview.spreadsheetTruncated", {
        rows: format.number(SPREADSHEET_MAX_ROWS),
        columns: format.number(SPREADSHEET_MAX_COLUMNS),
      })}
      dom={DOM_OPTIONS}
    />
  );
}

export function PreviewMessage({ text }: { text: string }) {
  return (
    <View className="flex-1 items-center justify-center px-6">
      <Typography.Paragraph className="text-center text-muted">{text}</Typography.Paragraph>
    </View>
  );
}

/** The file as Base64 for a DOM component, which cannot read the app's files. Null `uri` reads nothing. */
export function useFileBase64(uri: string | null) {
  const [state, setState] = useState<{ value: string | null; error: boolean }>({ value: null, error: false });
  useEffect(() => {
    setState({ value: null, error: false });
    if (!uri) return;
    let active = true;
    new File(uri)
      .base64()
      .then((value) => {
        if (active) setState({ value, error: false });
      })
      .catch(() => {
        if (active) setState({ value: null, error: true });
      });
    return () => {
      active = false;
    };
  }, [uri]);
  return state;
}
