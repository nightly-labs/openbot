import { render, screen, waitFor, within } from "@solidjs/testing-library";
import { beforeEach, expect, it } from "vitest";
import { App } from "./App";
import { emitAgentEvent, emitPresence, installOpenbotStub, presenceMember } from "./app-test-harness";

beforeEach(installOpenbotStub);

function userMessage(id: string, text: string, createdAt: string, senderMember?: { id: string; name: string }) {
  return {
    id,
    author: "user" as const,
    text,
    createdAt,
    status: "completed" as const,
    ...(senderMember ? { senderMember } : {}),
  };
}

it("names the other people in an agent chat and keeps the reader's and the agent's rows as before", async () => {
  render(() => <App />);
  await screen.findByRole("heading", { name: "Chief" });
  emitPresence?.({
    serverId: "local",
    updatedAt: "2026-08-19T10:00:00.000Z",
    members: [
      presenceMember("member-self", "person@example.com", "Person"),
      presenceMember("member-ada", "ada@example.com", "Ada Lovelace"),
    ],
  });
  emitAgentEvent?.({
    type: "conversation",
    snapshot: {
      agentId: "chief",
      threadId: "thread-chief",
      activeTurnId: null,
      revision: 1,
      messages: [
        userMessage("own", "My question", "2026-08-19T10:00:00.000Z", { id: "member-self", name: "Person" }),
        userMessage("legacy", "Sent before senders were kept", "2026-08-19T10:00:10.000Z"),
        // Presence holds a newer name than the one stored with the message.
        userMessage("ada-1", "Ada's first", "2026-08-19T10:01:00.000Z", { id: "member-ada", name: "Ada" }),
        userMessage("ada-2", "Ada's second", "2026-08-19T10:01:10.000Z", { id: "member-ada", name: "Ada" }),
        userMessage("grace", "Grace left the team", "2026-08-19T10:02:00.000Z", {
          id: "member-grace",
          name: "Grace Hopper",
        }),
        {
          id: "reply",
          author: "assistant",
          text: "Answer to Ada",
          createdAt: "2026-08-19T10:03:00.000Z",
          status: "completed",
          replyToMessageId: "ada-1",
        },
      ],
    },
  });

  const chat = await screen.findByRole("main", { name: "Conversation" });
  await waitFor(() =>
    expect(within(chat).getAllByRole("article", { name: "Message from Ada Lovelace" })).toHaveLength(2),
  );
  const [adaFirst, adaSecond] = within(chat).getAllByRole("article", { name: "Message from Ada Lovelace" });
  // A run by one person names them once.
  expect(adaFirst).toHaveTextContent("Ada Lovelace");
  expect(adaSecond).not.toHaveTextContent("Ada Lovelace");
  expect(within(chat).getByRole("article", { name: "Message from Grace Hopper" })).toHaveTextContent("Grace Hopper");

  const own = within(chat).getAllByRole("article", { name: "Message from You" });
  expect(own.map((row) => row.textContent)).toEqual([
    expect.stringContaining("My question"),
    expect.stringContaining("Sent before senders were kept"),
  ]);
  expect(own[0]).not.toHaveTextContent("Person");

  const reply = within(chat).getByRole("article", { name: "Message from Chief" });
  await waitFor(() => expect(reply).toHaveTextContent("Answer to Ada"));
  // The quote names the person, not "You".
  expect(reply).toHaveTextContent("Ada Lovelace");
});
