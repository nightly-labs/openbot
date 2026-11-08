import { Button, Select, SelectContent, SelectItem, SelectTrigger, SelectValue, Text } from "@openbot/ui";
import { Show } from "solid-js";
import { useText } from "../../text";

export interface HermesProfileOptions {
  readonly profiles: readonly string[];
  readonly loading: boolean;
  readonly unavailable: boolean;
  readonly modelsUnavailable: boolean;
  readonly retry: () => void;
}

// An empty value cannot be a Hermes ID.
const INHERIT = "";

export function HermesProfileSelect(props: {
  value: string | undefined;
  options: HermesProfileOptions;
  disabled?: boolean | undefined;
  onChange: (profileId: string | undefined) => void;
}) {
  const { t } = useText();
  const choices = () => {
    const ids = props.options.profiles;
    const saved = props.value;
    return [INHERIT, ...ids, ...(saved !== undefined && !ids.includes(saved) ? [saved] : [])];
  };
  const label = (id: string) => {
    if (id === INHERIT) return t("agentSettings.hermesProfile.inherit");
    if (!props.options.profiles.includes(id)) return t("agentSettings.hermesProfile.missing", { profile: id });
    return id === "default" ? t("agentSettings.hermesProfile.default") : id;
  };
  return (
    <div>
      <Text>{t("agentSettings.hermesProfile.label")}</Text>
      <Select<string>
        options={choices()}
        value={props.value ?? INHERIT}
        onChange={(id) => {
          if (id !== null) props.onChange(id === INHERIT ? undefined : id);
        }}
        disabled={props.disabled || props.options.loading}
        itemComponent={(item) => <SelectItem item={item.item}>{label(item.item.rawValue)}</SelectItem>}
      >
        <SelectTrigger aria-label={t("agentSettings.hermesProfile.label")}>
          <SelectValue<string>>{(state) => label(state.selectedOption())}</SelectValue>
        </SelectTrigger>
        <SelectContent />
      </Select>
      <Show when={props.options.loading}>
        <Text tone="muted">{t("agentSettings.hermesProfile.loading")}</Text>
      </Show>
      <Show when={props.options.unavailable || props.options.modelsUnavailable}>
        <Text role="alert" tone="muted">
          {props.options.unavailable
            ? t("agentSettings.hermesProfile.unavailable")
            : t("agentSettings.hermesProfile.modelsUnavailable")}
        </Text>
        <Button variant="ghost" onClick={() => props.options.retry()}>
          {t("common.retry")}
        </Button>
      </Show>
    </div>
  );
}
