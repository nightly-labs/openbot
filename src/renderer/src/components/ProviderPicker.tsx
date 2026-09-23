import {
  ProviderPicker as SharedProviderPicker,
  type ProviderPickerProps as SharedProviderPickerProps,
} from "@openbot/ui/components/ProviderPicker";
import { useI18n } from "../i18n-context";

export type ProviderPickerProps = Omit<SharedProviderPickerProps, "t">;

export function ProviderPicker(props: ProviderPickerProps) {
  const i18n = useI18n();
  return <SharedProviderPicker {...props} t={i18n.t} />;
}
