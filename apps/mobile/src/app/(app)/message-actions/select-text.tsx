import { Stack } from "expo-router";
import { Typography } from "heroui-native";
import { TextInput } from "react-native";
import { useCopyMessage } from "@/features/chat/components/use-copy-message";
import { useMessageActions } from "@/features/chat/context/message-actions-context";
import { SheetScrollView } from "@/shared/components/sheet-scroll-view";
import { isIOS } from "@/shared/lib/platform";

export default function SelectMessageTextScreen() {
  const { selected } = useMessageActions();
  const { copy, copied } = useCopyMessage(selected?.message.body ?? "");
  return (
    <>
      <Stack.Toolbar placement="right">
        <Stack.Toolbar.Button
          icon={copied ? "checkmark" : "doc.on.doc"}
          accessibilityLabel={copied ? "Message copied" : "Copy message"}
          onPress={() => {
            void copy();
          }}
        >
          {copied ? "Copied" : "Copy"}
        </Stack.Toolbar.Button>
      </Stack.Toolbar>
      <SheetScrollView contentContainerClassName="px-4 pb-safe-offset-5 pt-5">
        {isIOS ? (
          // iOS Text offers whole-message Copy only. UITextView supports range selection handles.
          <TextInput
            accessibilityLabel="Message text"
            value={selected?.message.body ?? ""}
            multiline
            editable={false}
            showSoftInputOnFocus={false}
            scrollEnabled={false}
            className="bg-transparent p-0 font-sans text-base leading-6 text-foreground"
          />
        ) : (
          <Typography.Paragraph selectable>{selected?.message.body}</Typography.Paragraph>
        )}
      </SheetScrollView>
    </>
  );
}
