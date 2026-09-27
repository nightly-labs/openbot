import { isDetectionFolder, PROVIDER_DETECTION_LIMITS } from "@openbot/contracts/ipc";
import { ItemGroup, SettingsSection, SwitchField, Text } from "@openbot/ui";
import { createStore, Show, untrack } from "solid-js";
import { useText } from "../../text";
import { endpointUrlError } from "./custom-provider-form";
import { RepeatableRows } from "./RepeatableRows";

/** Where the host looks, besides the default addresses and PATH. The host stores and applies it. */
export interface ProviderDetectionSettingsValue {
  enabled: boolean;
  /** Base URLs of more OpenAI-compatible servers, such as one on another port or computer. */
  addresses: readonly string[];
  /** More folders to search for known ACP agent commands. */
  folders: readonly string[];
}

interface ProviderDetectionSettingsProps {
  value: ProviderDetectionSettingsValue;
  onChange: (value: ProviderDetectionSettingsValue) => void;
  busy?: boolean | undefined;
  /** The last save failed. The host keeps the rows, so the user can correct them. */
  error?: string | null | undefined;
}

// The examples are the same in each language.
const ADDRESS_PLACEHOLDER = "http://192.168.1.20:11434/v1";
const FOLDER_PLACEHOLDER = "~/tools/bin";

interface ListRow {
  value: string;
}

type ListName = "addresses" | "folders";

/** A list always shows one row to type into. The host ignores a blank row. */
function listRows(values: readonly string[]): ListRow[] {
  return (values.length > 0 ? values : [""]).map((value) => ({ value }));
}

export function ProviderDetectionSettings(props: ProviderDetectionSettingsProps) {
  const { t } = useText();
  // The rows are read once and then owned here, so each keeps its input while the user types: a
  // list rebuilt from the strings would replace the focused field on each key.
  const [lists, setLists] = createStore<Record<ListName, ListRow[]>>(
    untrack(() => ({ addresses: listRows(props.value.addresses), folders: listRows(props.value.folders) })),
  );

  const publish = () =>
    props.onChange({
      ...props.value,
      addresses: lists.addresses.map((row) => row.value),
      folders: lists.folders.map((row) => row.value),
    });
  const edit = (list: ListName, change: (rows: ListRow[]) => void) => {
    setLists((state) => {
      change(state[list]);
    });
    publish();
  };

  const addressError = (index: number) => {
    const address = lists.addresses[index]?.value.trim();
    return address ? endpointUrlError(address, t) : undefined;
  };
  const folderError = (index: number) => {
    const folder = lists.folders[index]?.value.trim();
    return folder && !isDetectionFolder(folder)
      ? t("customProvider.detection.error.folderInvalid", { example: FOLDER_PLACEHOLDER })
      : undefined;
  };

  const setRow = (list: ListName, index: number, value: string) =>
    edit(list, (rows) => {
      const row = rows[index];
      if (row) row.value = value;
    });
  const addRow = (list: ListName) =>
    edit(list, (rows) => {
      rows.push({ value: "" });
    });
  const removeRow = (list: ListName, index: number) =>
    edit(list, (rows) => {
      rows.splice(index, 1);
    });

  return (
    <SettingsSection
      title={t("customProvider.detection.title")}
      description={t("customProvider.detection.description")}
    >
      <ItemGroup class="settings-modal-card">
        <SwitchField
          checked={props.value.enabled}
          disabled={props.busy === true}
          onChange={(enabled) => props.onChange({ ...props.value, enabled })}
          label={t("customProvider.detection.enabled")}
          description={t("customProvider.detection.enabledDescription")}
        />
      </ItemGroup>
      <Show when={props.error}>
        {(message) => (
          <Text class="custom-provider-submit-error" tone="danger" variant="caption" role="alert">
            {message()}
          </Text>
        )}
      </Show>
      <Show when={props.value.enabled}>
        <div class="detected-providers-settings">
          <RepeatableRows<ListRow>
            label={t("customProvider.detection.addresses")}
            removeLabel={(number) => t("customProvider.detection.address.remove", { number })}
            addLabel={t("customProvider.detection.address.add")}
            columns={[
              {
                label: (number) => t("customProvider.detection.address.label", { number }),
                placeholder: () => ADDRESS_PLACEHOLDER,
                maxlength: PROVIDER_DETECTION_LIMITS.entryLength,
                identifier: true,
                read: (row) => row.value,
                write: (index, value) => setRow("addresses", index, value),
              },
            ]}
            rows={lists.addresses}
            limit={PROVIDER_DETECTION_LIMITS.entries}
            busy={Boolean(props.busy)}
            rowError={addressError}
            onAdd={() => addRow("addresses")}
            onRemove={(index) => removeRow("addresses", index)}
          />
          <RepeatableRows<ListRow>
            label={t("customProvider.detection.folders")}
            removeLabel={(number) => t("customProvider.detection.folder.remove", { number })}
            addLabel={t("customProvider.detection.folder.add")}
            columns={[
              {
                label: (number) => t("customProvider.detection.folder.label", { number }),
                placeholder: () => FOLDER_PLACEHOLDER,
                maxlength: PROVIDER_DETECTION_LIMITS.entryLength,
                identifier: true,
                read: (row) => row.value,
                write: (index, value) => setRow("folders", index, value),
              },
            ]}
            rows={lists.folders}
            limit={PROVIDER_DETECTION_LIMITS.entries}
            busy={Boolean(props.busy)}
            rowError={folderError}
            onAdd={() => addRow("folders")}
            onRemove={(index) => removeRow("folders", index)}
          />
        </div>
      </Show>
    </SettingsSection>
  );
}
