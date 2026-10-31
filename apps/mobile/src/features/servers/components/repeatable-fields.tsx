import { Button, Typography } from "heroui-native";
import { useThemeColor } from "heroui-native/hooks";
import X from "lucide-react-native/icons/x";
import { type ReactNode, useRef, useState } from "react";
import { type TextInputProps, View } from "react-native";
import { SettingsRow, SettingsSection } from "@/features/settings/components/settings-content";
import { SheetFormField } from "@/shared/components/sheet-form-field";
import { haptics } from "@/shared/lib/haptics";

/** One item of a pair field: an argument name and its value, or a model ID and its name. */
export interface PairItem {
  key: string;
  value: string;
}

/**
 * The row keys of a list that the user edits. The list changes only through its field, so the keys
 * follow each add and remove, and a field keeps its focus when a row above it goes.
 */
function useRowKeys(count: number) {
  const next = useRef(count);
  const [keys, setKeys] = useState(() => Array.from({ length: count }, (_, index) => index));
  return {
    keys,
    add: () => setKeys((current) => [...current, next.current++]),
    remove: (index: number) => setKeys((current) => current.filter((_, position) => position !== index)),
  };
}

/** One item of a list field: its inputs and the remove button. */
function RepeatableRow({
  removeLabel,
  disabled,
  onRemove,
  children,
}: {
  removeLabel: string;
  disabled: boolean;
  onRemove: () => void;
  children: ReactNode;
}) {
  const muted = useThemeColor("muted");
  return (
    <View className="flex-row items-center pr-2">
      <View className="min-w-0 flex-1 flex-row items-center">{children}</View>
      <Button
        isIconOnly
        variant="ghost"
        size="sm"
        isDisabled={disabled}
        accessibilityLabel={removeLabel}
        onPress={() => {
          void haptics.selection();
          onRemove();
        }}
      >
        <X color={String(muted)} size={18} />
      </Button>
    </View>
  );
}

/** The last row of a list field. */
function RepeatableAddRow({ label, disabled, onPress }: { label: string; disabled: boolean; onPress: () => void }) {
  return (
    <SettingsRow disclosure={false} disabled={disabled} onPress={onPress}>
      <Typography.Paragraph className="text-accent">{label}</Typography.Paragraph>
    </SettingsRow>
  );
}

/** A list of single values, as the desktop form has: one field for each item. */
export function ListField({
  title,
  footer,
  items,
  maxItems,
  maxLength,
  autoCapitalize = "none",
  addLabel,
  itemLabel,
  itemPlaceholder,
  removeLabel,
  disabled,
  onChange,
}: {
  title: string;
  footer: string;
  items: string[];
  maxItems: number;
  maxLength: number;
  autoCapitalize?: TextInputProps["autoCapitalize"];
  addLabel: string;
  itemLabel: (position: number) => string;
  /** An example value. Without it, each field shows its label. */
  itemPlaceholder?: string;
  removeLabel: (position: number) => string;
  disabled: boolean;
  onChange: (items: string[]) => void;
}) {
  const rows = useRowKeys(items.length);
  return (
    <SettingsSection title={title} footer={footer}>
      {items.map((value, index) => (
        <RepeatableRow
          key={rows.keys[index]}
          removeLabel={removeLabel(index + 1)}
          disabled={disabled}
          onRemove={() => {
            rows.remove(index);
            onChange(items.filter((_, position) => position !== index));
          }}
        >
          <View className="min-w-0 flex-1">
            <SheetFormField
              hideLabel
              appearance="soft"
              label={itemLabel(index + 1)}
              placeholder={itemPlaceholder ?? itemLabel(index + 1)}
              autoCapitalize={autoCapitalize}
              autoCorrect={false}
              maxLength={maxLength}
              editable={!disabled}
              value={value}
              onChangeText={(next) => onChange(items.map((item, position) => (position === index ? next : item)))}
            />
          </View>
        </RepeatableRow>
      ))}
      <RepeatableAddRow
        label={addLabel}
        disabled={disabled || items.length >= maxItems}
        onPress={() => {
          rows.add();
          onChange([...items, ""]);
        }}
      />
    </SettingsSection>
  );
}

/** A list of name and value pairs, as the desktop form has: two fields for each item. */
export function PairField({
  title,
  footer,
  items,
  maxItems,
  maxKeyLength,
  maxValueLength,
  keyPlaceholder,
  valuePlaceholder,
  addLabel,
  keyLabel,
  valueLabel,
  removeLabel,
  disabled,
  onChange,
}: {
  title: string;
  footer: string;
  items: PairItem[];
  maxItems: number;
  maxKeyLength: number;
  maxValueLength: number;
  keyPlaceholder: string;
  valuePlaceholder: string;
  addLabel: string;
  keyLabel: (position: number) => string;
  valueLabel: (position: number) => string;
  removeLabel: (position: number) => string;
  disabled: boolean;
  onChange: (items: PairItem[]) => void;
}) {
  const rows = useRowKeys(items.length);
  const change = (index: number, part: Partial<PairItem>) =>
    onChange(items.map((item, position) => (position === index ? { ...item, ...part } : item)));
  return (
    <SettingsSection title={title} footer={footer}>
      {items.map((pair, index) => (
        <RepeatableRow
          key={rows.keys[index]}
          removeLabel={removeLabel(index + 1)}
          disabled={disabled}
          onRemove={() => {
            rows.remove(index);
            onChange(items.filter((_, position) => position !== index));
          }}
        >
          <View className="min-w-0 flex-1">
            <SheetFormField
              hideLabel
              appearance="soft"
              label={keyLabel(index + 1)}
              placeholder={keyPlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={maxKeyLength}
              editable={!disabled}
              value={pair.key}
              onChangeText={(key) => change(index, { key })}
            />
          </View>
          <View className="h-6 w-px bg-grouped-border" />
          <View className="min-w-0 flex-1">
            <SheetFormField
              hideLabel
              appearance="soft"
              label={valueLabel(index + 1)}
              placeholder={valuePlaceholder}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={maxValueLength}
              editable={!disabled}
              value={pair.value}
              onChangeText={(value) => change(index, { value })}
            />
          </View>
        </RepeatableRow>
      ))}
      <RepeatableAddRow
        label={addLabel}
        disabled={disabled || items.length >= maxItems}
        onPress={() => {
          rows.add();
          onChange([...items, { key: "", value: "" }]);
        }}
      />
    </SettingsSection>
  );
}
