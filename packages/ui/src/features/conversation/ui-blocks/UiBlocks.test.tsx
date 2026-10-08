import type {
  UiBlockResponse,
  UiBlockState,
  UiChoiceBlock as UiChoiceSpec,
  UiConfirmBlock as UiConfirmSpec,
  UiFormBlock as UiFormSpec,
  UiQuickRepliesBlock as UiQuickRepliesSpec,
} from "@openbot/contracts/ui-blocks";
import { validateUiBlockResponse } from "@openbot/contracts/ui-blocks";
import { fireEvent, render, screen, waitFor } from "@solidjs/testing-library";
import { createSignal, flush } from "solid-js";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";
import { UiBlockingBlock } from "./UiBlockingBlock";
import { UiChoiceBlock } from "./UiChoiceBlock";
import { UiConfirmBlock } from "./UiConfirmBlock";
import { UiFormBlock } from "./UiFormBlock";
import { UiQuickReplies } from "./UiQuickReplies";

const originalMatchMedia = window.matchMedia;

beforeEach(() => {
  window.matchMedia = vi.fn().mockReturnValue({ matches: true });
});

afterEach(() => {
  vi.useRealTimers();
  window.matchMedia = originalMatchMedia;
});

const confirmSpec: UiConfirmSpec = {
  type: "confirm",
  title: "Send the letter?",
  danger: true,
  confirmHold: 600,
  fields: [
    { label: "To", value: "board@example.com" },
    { label: "From", select: "from", options: ["me@example.com", "work@example.com"] },
  ],
  preview: "Hello, the heating is off.",
  actions: [
    { id: "send", label: "Send", style: "primary" },
    { id: "cancel", label: "Do not send", style: "ghost" },
  ],
};

const choiceSpec: UiChoiceSpec = {
  type: "choice",
  title: "Who gets the offer?",
  multiple: true,
  options: [
    { id: "a1", label: "Active", meta: "1284" },
    { id: "a2", label: "Sleeping", meta: "3102" },
    { id: "a3", label: "New", meta: "2040" },
  ],
};

const quickSpec: UiQuickRepliesSpec = {
  type: "quick_replies",
  options: [
    { id: "show", label: "Show the mail" },
    { id: "later", label: "Remind me later" },
  ],
};

const formSpec: UiFormSpec = {
  type: "form",
  title: "New ticket",
  fields: [
    { id: "subject", kind: "text", label: "Subject", required: true },
    { id: "note", kind: "textarea", label: "Note" },
    { id: "level", kind: "segmented", label: "Level", options: ["Low", "High"] },
  ],
  submit: "Create",
};

type Respond = Mock<(response: UiBlockResponse) => void>;

function lastResponse(onRespond: Respond): UiBlockResponse {
  const call = onRespond.mock.calls.at(-1);
  if (!call) throw new Error("onRespond was not called");
  return call[0];
}

describe("UiConfirmBlock", () => {
  it("acts on a held button only after the full hold", async () => {
    vi.useFakeTimers();
    const onRespond: Respond = vi.fn();
    render(() => <UiConfirmBlock spec={confirmSpec} onRespond={onRespond} />);
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.pointerDown(send);
    vi.advanceTimersByTime(599);
    expect(onRespond).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(onRespond).toHaveBeenCalledTimes(1);
    expect(lastResponse(onRespond)).toEqual({ actionId: "send", values: { from: "me@example.com" } });
    expect(validateUiBlockResponse(confirmSpec, lastResponse(onRespond))).not.toBeNull();
  });

  it("starts over when the hold is let go early, and ignores a plain click", async () => {
    vi.useFakeTimers();
    const onRespond: Respond = vi.fn();
    render(() => <UiConfirmBlock spec={confirmSpec} onRespond={onRespond} />);
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.pointerDown(send);
    vi.advanceTimersByTime(400);
    fireEvent.pointerUp(send);
    vi.advanceTimersByTime(1000);
    fireEvent.click(send);
    expect(onRespond).not.toHaveBeenCalled();
  });

  it("holds with the keyboard", () => {
    vi.useFakeTimers();
    const onRespond: Respond = vi.fn();
    render(() => <UiConfirmBlock spec={confirmSpec} onRespond={onRespond} />);
    const send = screen.getByRole("button", { name: "Send" });

    fireEvent.keyDown(send, { key: "Enter" });
    fireEvent.keyDown(send, { key: "Enter", repeat: true });
    vi.advanceTimersByTime(600);
    expect(onRespond).toHaveBeenCalledTimes(1);
  });

  it("sends the chosen select value and answers an ordinary button at once", async () => {
    const onRespond: Respond = vi.fn();
    render(() => <UiConfirmBlock spec={confirmSpec} onRespond={onRespond} />);
    await fireEvent.change(screen.getByRole("combobox", { name: "From" }), { target: { value: "work@example.com" } });
    await fireEvent.click(screen.getByRole("button", { name: "Do not send" }));
    expect(lastResponse(onRespond)).toEqual({ actionId: "cancel", values: { from: "work@example.com" } });
  });

  it("shows the outcome and no buttons once answered", () => {
    const state: UiBlockState = {
      status: "answered",
      response: { actionId: "send", values: { from: "work@example.com" } },
      outcome: "Send · work@example.com",
    };
    render(() => <UiConfirmBlock spec={confirmSpec} state={state} onRespond={vi.fn()} />);
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
    expect(screen.getByText("Send · work@example.com")).toBeVisible();
    expect(screen.getByRole("combobox", { name: "From" })).toBeDisabled();
    expect(screen.getByRole("combobox", { name: "From" })).toHaveValue("work@example.com");
  });
});

describe("UiChoiceBlock", () => {
  it("chooses options by their letter and sends the ids in order", async () => {
    const onRespond: Respond = vi.fn();
    render(() => <UiChoiceBlock spec={choiceSpec} onRespond={onRespond} />);
    const send = screen.getByRole("button", { name: "Send" });
    expect(send).toBeDisabled();

    await fireEvent.keyDown(screen.getByRole("checkbox", { name: "Active" }), { key: "c" });
    await fireEvent.keyDown(screen.getByRole("checkbox", { name: "Active" }), { key: "A" });
    await waitFor(() => expect(screen.getByRole("checkbox", { name: "New" })).toBeChecked());
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeChecked();
    expect(screen.getByText("2 selected")).toBeVisible();

    await fireEvent.click(send);
    expect(lastResponse(onRespond)).toEqual({ actionId: "submit", values: { selected: ["a1", "a3"] } });
  });

  it("keeps one option for a single choice", async () => {
    const onRespond: Respond = vi.fn();
    render(() => <UiChoiceBlock spec={{ ...choiceSpec, multiple: false }} onRespond={onRespond} />);
    await fireEvent.click(screen.getByRole("radio", { name: "Sleeping" }));
    await fireEvent.click(screen.getByRole("radio", { name: "New" }));
    await waitFor(() => expect(screen.getByRole("radio", { name: "New" })).toBeChecked());
    expect(screen.getByRole("radio", { name: "Sleeping" })).not.toBeChecked();
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(lastResponse(onRespond).values).toEqual({ selected: ["a3"] });
  });

  it("freezes on the stored answer", () => {
    const state: UiBlockState = {
      status: "answered",
      response: { actionId: "submit", values: { selected: ["a2"] } },
      outcome: "Sleeping",
    };
    render(() => <UiChoiceBlock spec={choiceSpec} state={state} onRespond={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "Send" })).not.toBeInTheDocument();
    expect(screen.getByRole("checkbox", { name: "Sleeping" })).toBeChecked();
    expect(screen.getByRole("checkbox", { name: "Sleeping" })).toBeDisabled();
    expect(screen.getByRole("checkbox", { name: "Active" })).toBeDisabled();
  });
});

describe("UiQuickReplies", () => {
  it("sends the chosen chip and turns the others off", async () => {
    const onRespond: Respond = vi.fn();
    const [state, setState] = createSignal<UiBlockState>({ status: "pending" });
    render(() => <UiQuickReplies spec={quickSpec} state={state()} onRespond={onRespond} />);

    await fireEvent.click(screen.getByRole("button", { name: "Show the mail" }));
    expect(lastResponse(onRespond)).toEqual({ actionId: "show" });

    setState({ status: "answered", response: { actionId: "show" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Remind me later" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "Show the mail" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "Remind me later" })).toHaveAttribute("aria-pressed", "false");
  });

  it("sends a typed reply as words", async () => {
    const onRespond: Respond = vi.fn();
    render(() => <UiQuickReplies spec={{ ...quickSpec, allowText: true }} onRespond={onRespond} />);
    await fireEvent.input(screen.getByRole("textbox", { name: "Your own reply" }), { target: { value: " tomorrow " } });
    await fireEvent.click(screen.getByRole("button", { name: "Send" }));
    expect(lastResponse(onRespond)).toEqual({ actionId: "_text", text: "tomorrow" });
  });
});

describe("UiFormBlock", () => {
  it("refuses to send while a required field is empty", async () => {
    const onRespond: Respond = vi.fn();
    render(() => <UiFormBlock spec={formSpec} onRespond={onRespond} />);
    await fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("This field is required");
    expect(onRespond).not.toHaveBeenCalled();

    await fireEvent.input(screen.getByRole("textbox", { name: /Subject/ }), { target: { value: "Heating" } });
    await fireEvent.click(screen.getByRole("button", { name: "High" }));
    await fireEvent.click(screen.getByRole("button", { name: "Create" }));
    expect(lastResponse(onRespond)).toEqual({
      actionId: "submit",
      values: { subject: "Heating", level: "High" },
    });
  });

  it("cannot be edited once answered", () => {
    const state: UiBlockState = {
      status: "answered",
      response: { actionId: "submit", values: { subject: "Heating" } },
      outcome: "Subject: Heating",
    };
    render(() => <UiFormBlock spec={formSpec} state={state} onRespond={vi.fn()} />);
    expect(screen.getByRole("textbox", { name: /Subject/ })).toBeDisabled();
    expect(screen.getByRole("textbox", { name: /Subject/ })).toHaveValue("Heating");
    expect(screen.queryByRole("button", { name: "Create" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "High" })).toBeDisabled();
  });
});

describe("UiBlockingBlock", () => {
  it("draws the card for the block type, with a skip button and a refused answer", async () => {
    const onSkip = vi.fn();
    render(() => (
      <UiBlockingBlock
        spec={choiceSpec}
        onRespond={vi.fn()}
        onSkip={onSkip}
        error="Only the server owner or an admin can choose this action."
      />
    ));
    expect(screen.getByRole("article", { name: "Who gets the offer?" })).toBeInTheDocument();
    expect(screen.getByRole("alert")).toHaveTextContent("Only the server owner or an admin can choose this action.");
    await fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(onSkip).toHaveBeenCalledOnce();
  });

  it("offers a skip next to quick replies and none once the block is frozen", () => {
    const [state, setState] = createSignal<UiBlockState | undefined>();
    render(() => <UiBlockingBlock spec={quickSpec} state={state()} onRespond={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Skip" })).toBeEnabled();
    setState({ status: "closed" });
    flush();
    expect(screen.queryByRole("button", { name: "Skip" })).not.toBeInTheDocument();
  });

  it("disables the skip while an answer is on its way", () => {
    render(() => <UiBlockingBlock spec={formSpec} busy onRespond={vi.fn()} onSkip={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Skip" })).toBeDisabled();
  });
});
