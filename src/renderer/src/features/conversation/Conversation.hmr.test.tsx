import { render } from "@solidjs/testing-library";
import { expect, it, vi } from "vitest";
import { createStableConversationState } from "./conversation-controller";

it("restores a held desktop draft and its edit identity after the controller is recreated", () => {
  window.localStorage.setItem(
    "openbot:queue-edit",
    JSON.stringify({
      agentId: "chief",
      serverId: "local",
      deliveryId: "held",
      editId: "editor",
      originalAttachmentIds: [],
      backup: { text: "Unsent", attachments: [], replyToMessageId: null },
      draft: { text: "Still editing", attachments: [], replyToMessageId: null },
    }),
  );
  let restored: ReturnType<typeof createStableConversationState> | undefined;
  function Harness() {
    restored = createStableConversationState({ onTypingChange: vi.fn() });
    return <div />;
  }
  const view = render(() => <Harness />);
  expect(restored?.editingEditId()).toBe("editor");
  expect(restored?.editingDeliveryId()).toBe("held");
  expect(Object.values(restored?.drafts() ?? {}).map((draft) => draft.text)).toContain("Still editing");
  view.unmount();
  window.localStorage.removeItem("openbot:queue-edit");
});
