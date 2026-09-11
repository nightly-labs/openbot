import { Stack } from "expo-router";
import { isIOS } from "@/shared/lib/platform";

export function SheetSaveAction({
  dirty,
  canSave,
  pending,
  label = "Save changes",
  pendingLabel = "Saving…",
  onSave,
}: {
  dirty: boolean;
  canSave: boolean;
  pending: boolean;
  label?: string;
  pendingLabel?: string;
  onSave: () => void;
}) {
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        hidden={!dirty && !pending}
        disabled={!dirty || !canSave || pending}
        icon={isIOS ? "checkmark" : undefined}
        accessibilityLabel={pending ? pendingLabel : label}
        onPress={() => {
          if (dirty && canSave && !pending) onSave();
        }}
      >
        {isIOS ? label : "✓"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
