import { Stack } from "expo-router";
import { useEffect, useRef, useState } from "react";
import { isIOS } from "@/shared/lib/platform";

export function SheetSaveAction({
  canSave,
  pending,
  saved,
  onSave,
  onSavedHidden,
}: {
  canSave: boolean;
  pending: boolean;
  saved: boolean;
  onSave: () => void;
  onSavedHidden?: () => void;
}) {
  const [showSaved, setShowSaved] = useState(false);
  const hidden = useRef(onSavedHidden);
  hidden.current = onSavedHidden;
  useEffect(() => {
    setShowSaved(saved);
    if (!saved) return;
    const timer = setTimeout(() => {
      setShowSaved(false);
      hidden.current?.();
    }, 1500);
    return () => clearTimeout(timer);
  }, [saved]);
  return (
    <Stack.Toolbar placement="right">
      <Stack.Toolbar.Button
        hidden={!canSave && !pending && !showSaved}
        disabled={!canSave || pending || showSaved}
        icon={isIOS && !showSaved ? "checkmark" : undefined}
        accessibilityLabel={showSaved ? "Saved" : pending ? "Saving…" : "Save changes"}
        onPress={onSave}
      >
        {showSaved ? "Saved" : isIOS ? "Save changes" : "✓"}
      </Stack.Toolbar.Button>
    </Stack.Toolbar>
  );
}
