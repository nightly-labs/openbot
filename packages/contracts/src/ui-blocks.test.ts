import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentPromptQuestion } from "./ipc-conversation-messages";
import {
  type ConversationUiBlock,
  isConversationUiBlock,
  isUiBlockId,
  isUiBlockSpec,
  normalizeConversationUiBlock,
  normalizeUiBlockSpec,
  UI_BLOCK_LIMITS,
  UI_BLOCK_TEXT_ACTION_ID,
  type UiBlockSpec,
  type UiChoiceBlock,
  type UiConfirmBlock,
  type UiFormBlock,
  type UiQuickRepliesBlock,
  uiBlockActionIsPrivileged,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
  uiBlockHasPrivilegedAction,
  uiBlockOutcomeText,
  uiBlockResponseFromAnswers,
  validateUiBlockResponse,
} from "./ui-blocks";

// The specs of the approved demo (agent-ui-blocks.html). The form `select` field has options, which
// the demo left out (a select needs them).
const confirm: UiConfirmBlock = {
  type: "confirm",
  title: "Отправить письмо в ТСЖ?",
  danger: true,
  confirmHold: 600,
  fields: [
    { label: "Кому", value: "tsj_onyx@mail.ru" },
    { label: "От", select: "from", options: ["sysrootix@gmail.com", "nekitterekhin@gmail.com"] },
    { label: "Тема", value: "Кв. 41: нет отопления по стояку" },
  ],
  preview: "Здравствуйте! Квартира 41…",
  actions: [
    { id: "send", label: "Отправить", style: "primary" },
    { id: "edit", label: "Изменить" },
    { id: "cancel", label: "Не отправлять", style: "ghost" },
  ],
};

const quickReplies: UiQuickRepliesBlock = {
  type: "quick_replies",
  options: [
    { id: "show", label: "Покажи письмо" },
    { id: "remind", label: "Напомни 11 октября" },
    { id: "task", label: "Добавь в задачи" },
    { id: "skip", label: "Не важно" },
  ],
  allowText: true,
};

const choice: UiChoiceBlock = {
  type: "choice",
  title: "Кому отправить акцию?",
  multiple: true,
  options: [
    { id: "protein90", label: "Покупали протеин за 90 дней", meta: "1 284", selected: true },
    { id: "sleeping", label: "Спящие клиенты", meta: "3 102" },
    { id: "vvo", label: "Только Владивосток", meta: "2 040" },
  ],
  submit: "Создать черновик",
};

const form: UiFormBlock = {
  type: "form",
  title: "Новая заявка",
  fields: [
    { id: "what", kind: "text", label: "Что случилось", required: true },
    { id: "urgency", kind: "segmented", options: ["Обычная", "Высокая", "Критично"] },
    { id: "due", kind: "date", label: "Срок" },
    { id: "to", kind: "select", label: "Кому передать", options: ["Сантехник", "Электрик"] },
    { id: "note", kind: "textarea", label: "Комментарий" },
  ],
  submit: "Создать заявку",
};

const DEMO_SPECS = { confirm, quickReplies, choice, form };

function normalizedConfirmSpec(): UiConfirmBlock {
  const normalized = normalizeUiBlockSpec(confirm);
  if (normalized?.type !== "confirm") throw new Error("invalid confirm spec");
  return normalized;
}

describe("ui block specs", () => {
  it.each(Object.entries(DEMO_SPECS))("accepts the demo %s block", (_, value) => {
    expect(isUiBlockSpec(value)).toBe(true);
  });

  it("drops keys it does not know", () => {
    expect(normalizeUiBlockSpec({ ...confirm, notify: "push" })).toEqual(confirm);
  });

  it("rejects an unknown type and a display block", () => {
    expect(isUiBlockSpec({ ...confirm, type: "dialog" })).toBe(false);
    expect(isUiBlockSpec({ type: "alert", severity: "info", title: "Not here yet" })).toBe(false);
    expect(isUiBlockSpec(null)).toBe(false);
    expect(isUiBlockSpec([confirm])).toBe(false);
  });

  it("rejects broken fields", () => {
    expect(isUiBlockSpec({ ...confirm, title: "" })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, title: 1 })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, actions: [] })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, actions: [{ id: "a", label: "A", style: "neon" }] })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, confirmHold: 100 })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, confirmHold: 5_000 })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "d", kind: "date", label: "D", value: "2026-02-30" }] })).toBe(
      false,
    );
    expect(isUiBlockSpec({ ...form, fields: [{ id: "s", kind: "select", label: "S", options: [] }] })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "s", kind: "select", options: ["a"], value: "b" }] })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "p", kind: "textarea", label: "P", secret: true }] })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "p", kind: "text", label: "P", secret: true, value: "x" }] })).toBe(
      false,
    );
  });

  it("rejects duplicate ids and option labels", () => {
    expect(isUiBlockSpec({ ...confirm, actions: [confirm.actions[0], confirm.actions[0]] })).toBe(false);
    expect(
      isUiBlockSpec({
        ...quickReplies,
        options: [
          { id: "a", label: "Yes" },
          { id: "b", label: "yes" },
        ],
      }),
    ).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [form.fields[0], form.fields[0]] })).toBe(false);
    expect(isUiBlockSpec({ ...choice, multiple: false })).toBe(true);
    expect(
      isUiBlockSpec({
        ...choice,
        multiple: false,
        options: choice.options.map((option) => ({ ...option, selected: true })),
      }),
    ).toBe(false);
  });

  it("rejects reserved and legacy ids", () => {
    expect(isUiBlockId("send")).toBe(true);
    expect(isUiBlockId("_text")).toBe(false);
    expect(isUiBlockId("__proto__")).toBe(false);
    expect(isUiBlockId("botId")).toBe(false);
    expect(isUiBlockId("a b")).toBe(false);
    expect(isUiBlockId("x".repeat(UI_BLOCK_LIMITS.id + 1))).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "botId", kind: "text", label: "Bot" }] })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, fields: [{ label: "Action", select: "action", options: ["a"] }] })).toBe(false);
  });

  it("enforces the limits", () => {
    const many = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ id: `o${index}`, label: `O${index}` }));
    expect(isUiBlockSpec({ ...quickReplies, options: many(UI_BLOCK_LIMITS.quickReplies) })).toBe(true);
    expect(isUiBlockSpec({ ...quickReplies, options: many(UI_BLOCK_LIMITS.quickReplies + 1) })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, actions: many(UI_BLOCK_LIMITS.actions + 1) })).toBe(false);
    expect(isUiBlockSpec({ ...choice, options: many(UI_BLOCK_LIMITS.choiceOptions + 1) })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, title: "x".repeat(UI_BLOCK_LIMITS.title + 1) })).toBe(false);
    expect(isUiBlockSpec({ ...confirm, preview: "x".repeat(UI_BLOCK_LIMITS.preview + 1) })).toBe(false);
    // The JSON limit holds even when each field is within its own limit.
    expect(isUiBlockSpec({ ...confirm, notes: "x".repeat(UI_BLOCK_LIMITS.specJson) })).toBe(false);
  });
});

describe("ui block responses", () => {
  const confirmSpec = normalizedConfirmSpec();

  it("accepts a response for every block", () => {
    expect(
      validateUiBlockResponse(confirmSpec, { actionId: "send", values: { from: "nekitterekhin@gmail.com" } }),
    ).toEqual({
      actionId: "send",
      values: { from: "nekitterekhin@gmail.com" },
    });
    expect(validateUiBlockResponse(quickReplies, { actionId: "remind" })).not.toBeNull();
    expect(validateUiBlockResponse(quickReplies, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "Позже" })).not.toBeNull();
    expect(
      validateUiBlockResponse(choice, { actionId: "submit", values: { selected: ["protein90", "vvo"] } }),
    ).not.toBeNull();
    expect(
      validateUiBlockResponse(form, {
        actionId: "submit",
        values: { what: "Нет отопления", urgency: "Высокая", due: "2026-10-09", to: "Сантехник", note: "" },
      }),
    ).not.toBeNull();
  });

  it("drops keys it does not know", () => {
    expect(validateUiBlockResponse(confirmSpec, { actionId: "edit", extra: 1, approved: true })).toEqual({
      actionId: "edit",
    });
  });

  it("rejects unknown ids", () => {
    expect(validateUiBlockResponse(confirmSpec, { actionId: "delete" })).toBeNull();
    expect(validateUiBlockResponse(confirmSpec, { actionId: "send", values: { to: "x" } })).toBeNull();
    expect(validateUiBlockResponse(quickReplies, { actionId: "never" })).toBeNull();
    expect(validateUiBlockResponse(choice, { actionId: "submit", values: { selected: ["nobody"] } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { what: "x", extra: "y" } })).toBeNull();
  });

  it("rejects values of the wrong kind", () => {
    expect(validateUiBlockResponse(confirmSpec, { actionId: "send", values: { from: "evil@example.com" } })).toBeNull();
    expect(
      validateUiBlockResponse(
        { ...choice, multiple: false },
        { actionId: "submit", values: { selected: ["vvo", "sleeping"] } },
      ),
    ).toBeNull();
    expect(validateUiBlockResponse(choice, { actionId: "submit", values: { selected: [] } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { what: "" } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { urgency: "Высокая" } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { what: "x", due: "09.10.2026" } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { what: "x", urgency: "Никогда" } })).toBeNull();
  });

  it("takes words with text only", () => {
    expect(
      validateUiBlockResponse(confirmSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "Пока нет" }),
    ).not.toBeNull();
    expect(validateUiBlockResponse(confirmSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID })).toBeNull();
    expect(validateUiBlockResponse(confirmSpec, { actionId: "edit", text: "ok" })).toBeNull();
  });

  it("bounds the response size", () => {
    expect(
      validateUiBlockResponse(form, {
        actionId: "submit",
        values: { what: "x".repeat(UI_BLOCK_LIMITS.fieldValue + 1) },
      }),
    ).toBeNull();
    const fields = Array.from({ length: 3 }, (_, index) => ({
      id: `f${index}`,
      kind: "textarea" as const,
      label: "F",
    }));
    const values = Object.fromEntries(fields.map((field) => [field.id, "x".repeat(UI_BLOCK_LIMITS.fieldValue)]));
    expect(validateUiBlockResponse({ ...form, fields }, { actionId: "submit", values })).toBeNull();
  });

  it("marks danger and confirm actions as privileged", () => {
    expect(uiBlockActionIsPrivileged(confirmSpec, "send")).toBe(true);
    expect(uiBlockActionIsPrivileged(confirmSpec, "cancel")).toBe(false);
    expect(uiBlockActionIsPrivileged({ ...confirmSpec, danger: false }, "send")).toBe(false);
    expect(
      uiBlockActionIsPrivileged({ ...confirmSpec, actions: [{ id: "go", label: "Go", confirm: true }] }, "go"),
    ).toBe(true);
    expect(uiBlockActionIsPrivileged(quickReplies, "skip")).toBe(false);
  });

  it("tells whether a block has a privileged action", () => {
    expect(uiBlockHasPrivilegedAction(confirmSpec)).toBe(true);
    expect(uiBlockHasPrivilegedAction({ ...confirmSpec, danger: false })).toBe(false);
    expect(uiBlockHasPrivilegedAction(choice)).toBe(false);
  });
});

describe("ui block fallbacks", () => {
  const blocking: UiBlockSpec[] = [normalizedConfirmSpec(), quickReplies, choice, form];

  it.each(blocking.map((block) => [block.type, block] as const))(
    "turns a %s block into valid prompt questions",
    (_, block) => {
      const questions = uiBlockFallbackQuestions(block);
      expect(questions.length).toBeGreaterThan(0);
      expect(questions.length).toBeLessThanOrEqual(INPUT_LIMITS.promptQuestions);
      expect(questions.every(isAgentPromptQuestion)).toBe(true);
      expect(new Set(questions.map((item) => item.id)).size).toBe(questions.length);
    },
  );

  it("asks a confirm as its actions and selects", () => {
    const [action, from] = uiBlockFallbackQuestions(normalizedConfirmSpec());
    expect(action?.id).toBe("action");
    expect(action?.options?.map((option) => option.label)).toEqual(["Отправить", "Изменить", "Не отправлять"]);
    expect(action?.question).toContain("Кому: tsj_onyx@mail.ru");
    expect(action?.question).toContain("Здравствуйте!");
    expect(from?.id).toBe("from");
    expect(from?.options).toHaveLength(2);
  });

  it("puts more than five options in the question text", () => {
    const options = Array.from({ length: 8 }, (_, index) => ({ id: `o${index}`, label: `Option ${index}` }));
    const [reply] = uiBlockFallbackQuestions({ type: "quick_replies", options });
    expect(reply?.options).toBeNull();
    expect(reply?.question).toContain("- Option 7");
    const [few] = uiBlockFallbackQuestions(quickReplies);
    expect(few?.options).toHaveLength(4);
  });

  it("asks a multiple choice for typed labels", () => {
    const [multi] = uiBlockFallbackQuestions(choice);
    expect(multi?.options).toBeNull();
    expect(multi?.question).toContain("Спящие клиенты (3 102)");
    const [single] = uiBlockFallbackQuestions({ ...choice, multiple: false });
    expect(single?.options?.[0]).toEqual({ label: "Покупали протеин за 90 дней", description: "1 284" });
  });

  it("asks a form field by field", () => {
    const questions = uiBlockFallbackQuestions(form);
    expect(questions.map((item) => item.id)).toEqual(["what", "urgency", "due", "to", "note"]);
    expect(questions[1]?.options?.map((option) => option.label)).toEqual(["Обычная", "Высокая", "Критично"]);
    expect(questions[2]?.question).toContain("YYYY-MM-DD");
  });

  it("reads the answers of a client that only saw the questions", () => {
    const confirmSpec = normalizedConfirmSpec();
    expect(
      uiBlockResponseFromAnswers(confirmSpec, { action: ["Отправить"], from: ["nekitterekhin@gmail.com"] }),
    ).toEqual({
      actionId: "send",
      values: { from: "nekitterekhin@gmail.com" },
    });
    expect(uiBlockResponseFromAnswers(confirmSpec, { action: ["send"] })).toEqual({ actionId: "send" });
    expect(uiBlockResponseFromAnswers(quickReplies, { reply: ["не важно"] })).toEqual({ actionId: "skip" });
    expect(uiBlockResponseFromAnswers(choice, { choice: ["Спящие клиенты, Только Владивосток"] })).toEqual({
      actionId: "submit",
      values: { selected: ["sleeping", "vvo"] },
    });
    expect(
      uiBlockResponseFromAnswers(form, { what: ["Течёт кран"], urgency: ["высокая"], due: ["2026-10-09"] }),
    ).toEqual({ actionId: "submit", values: { what: "Течёт кран", urgency: "Высокая", due: "2026-10-09" } });
  });

  it("reads a choice label that holds a comma or a semicolon", () => {
    const comma: UiChoiceBlock = {
      type: "choice",
      title: "Что делаем?",
      options: [
        { id: "send", label: "Да, отправить" },
        { id: "wait", label: "Нет; подождать" },
        { id: "draft", label: "Черновик" },
      ],
    };
    expect(uiBlockResponseFromAnswers(comma, { choice: ["Да, отправить"] })).toEqual({
      actionId: "submit",
      values: { selected: ["send"] },
    });
    expect(uiBlockResponseFromAnswers(comma, { choice: ["send"] })).toEqual({
      actionId: "submit",
      values: { selected: ["send"] },
    });
    const multi: UiChoiceBlock = { ...comma, multiple: true };
    expect(uiBlockResponseFromAnswers(multi, { choice: ["Нет; подождать"] })).toEqual({
      actionId: "submit",
      values: { selected: ["wait"] },
    });
    expect(uiBlockResponseFromAnswers(multi, { choice: ["Да, отправить\nНет; подождать"] })).toEqual({
      actionId: "submit",
      values: { selected: ["send", "wait"] },
    });
    expect(uiBlockResponseFromAnswers(multi, { choice: ["Черновик, send"] })).toEqual({
      actionId: "submit",
      values: { selected: ["draft", "send"] },
    });
    for (const selected of [["send"], ["send", "wait"], ["wait", "draft"]]) {
      const block = selected.length > 1 ? multi : comma;
      const response = { actionId: "submit", values: { selected } };
      expect(uiBlockResponseFromAnswers(block, uiBlockAnswersFromResponse(block, response))).toEqual(response);
    }
  });

  it("keeps an unreadable answer as words", () => {
    expect(uiBlockResponseFromAnswers(quickReplies, { reply: ["Напомни завтра"] })).toEqual({
      actionId: UI_BLOCK_TEXT_ACTION_ID,
      text: "Напомни завтра",
    });
    expect(uiBlockResponseFromAnswers(form, { urgency: ["Высокая"] })).toEqual({
      actionId: UI_BLOCK_TEXT_ACTION_ID,
      text: "urgency (optional): Высокая",
    });
    expect(uiBlockResponseFromAnswers(choice, {})).toBeNull();
    expect(uiBlockResponseFromAnswers(choice, { choice: ["  "] })).toBeNull();
  });

  it("round-trips a response through the prompt answers", () => {
    const cases: Array<[UiBlockSpec, unknown]> = [
      [normalizedConfirmSpec(), { actionId: "send", values: { from: "nekitterekhin@gmail.com" } }],
      [quickReplies, { actionId: "task" }],
      [quickReplies, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "Позвони мне" }],
      [choice, { actionId: "submit", values: { selected: ["protein90", "vvo"] } }],
      [
        { ...choice, multiple: false },
        { actionId: "submit", values: { selected: ["vvo"] } },
      ],
      [form, { actionId: "submit", values: { what: "Кран", urgency: "Критично", due: "2026-10-09", to: "Электрик" } }],
    ];
    for (const [block, raw] of cases) {
      const response = validateUiBlockResponse(block, raw);
      expect(response).not.toBeNull();
      if (!response) continue;
      expect(uiBlockResponseFromAnswers(block, uiBlockAnswersFromResponse(block, response))).toEqual(response);
    }
  });

  it("describes the outcome of a response", () => {
    expect(uiBlockOutcomeText(normalizedConfirmSpec(), { actionId: "send", values: { from: "a@b.c" } })).toBe(
      "Отправить · a@b.c",
    );
    expect(uiBlockOutcomeText(choice, { actionId: "submit", values: { selected: ["protein90", "vvo"] } })).toBe(
      "Покупали протеин за 90 дней, Только Владивосток",
    );
    expect(uiBlockOutcomeText(form, { actionId: "submit", values: { what: "Кран", urgency: "Высокая" } })).toBe(
      "Что случилось: Кран, urgency: Высокая",
    );
    const list = (items: readonly string[]) => items.join(" и ");
    expect(uiBlockOutcomeText(choice, { actionId: "submit", values: { selected: ["sleeping", "vvo"] } }, list)).toBe(
      "Спящие клиенты и Только Владивосток",
    );
  });
});

describe("conversation ui blocks", () => {
  const sender = { id: "member-1", name: "Никита" };
  const answered: ConversationUiBlock = {
    version: 1,
    blockId: "mail-tsj",
    spec: normalizedConfirmSpec(),
    state: {
      status: "answered",
      response: { actionId: "send", values: { from: "sysrootix@gmail.com" } },
      respondedBy: sender,
      respondedAt: "2026-10-08T10:00:00.000Z",
      outcome: "Отправить · sysrootix@gmail.com",
    },
  };

  it("accepts a pending, an answered, an expired and a closed block", () => {
    expect(isConversationUiBlock({ version: 1, blockId: "b1", spec: quickReplies, state: { status: "pending" } })).toBe(
      true,
    );
    expect(isConversationUiBlock(answered)).toBe(true);
    for (const status of ["expired", "closed"]) {
      expect(isConversationUiBlock({ ...answered, state: { status } })).toBe(true);
    }
  });

  it("fails closed on a broken block", () => {
    expect(isConversationUiBlock({ ...answered, version: 2 })).toBe(false);
    expect(isConversationUiBlock({ ...answered, blockId: "" })).toBe(false);
    for (const blockId of ["botId", "recipientBotId", "recipientBotIds", "senderBotId", "_text"]) {
      expect(isConversationUiBlock({ ...answered, blockId })).toBe(false);
    }
    expect(isConversationUiBlock({ ...answered, spec: { ...confirm, type: "nope" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "open" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "answered" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "answered", response: { actionId: "nope" } } })).toBe(
      false,
    );
    expect(isConversationUiBlock({ ...answered, state: { ...answered.state, respondedBy: { id: "" } } })).toBe(false);
  });
});

describe("secret form fields", () => {
  const login: UiFormBlock = {
    type: "form",
    title: "Вход в 1С",
    fields: [
      { id: "user", kind: "text", label: "Логин", required: true },
      { id: "password", kind: "text", label: "Пароль", required: true, secret: true },
    ],
  };
  const response = { actionId: "submit", values: { user: "admin", password: "hunter2" } };

  it("asks a secret field as a secret question", () => {
    expect(uiBlockFallbackQuestions(login).map((item) => item.isSecret)).toEqual([false, true]);
  });

  it("gives the agent the value but never stores it", () => {
    expect(validateUiBlockResponse(login, response)).toEqual(response);
    expect(validateUiBlockResponse(login, { actionId: "submit", values: { user: "admin" } })).toBeNull();
    const stored = normalizeConversationUiBlock({
      version: 1,
      blockId: "login",
      spec: login,
      state: { status: "answered", response, outcome: uiBlockOutcomeText(login, response) },
    });
    expect(stored?.state).toEqual({
      status: "answered",
      response: { actionId: "submit", values: { user: "admin" } },
      outcome: "Логин: admin",
    });
    expect(JSON.stringify(stored)).not.toContain("hunter2");
  });

  it("keeps a secret answer out of an answer in words", () => {
    const answer = uiBlockResponseFromAnswers(
      { ...login, fields: [...login.fields, { id: "db", kind: "select", label: "База", options: ["ut"] }] },
      {
        user: ["admin"],
        password: ["hunter2"],
        db: ["other"],
      },
    );
    expect(answer?.actionId).toBe(UI_BLOCK_TEXT_ACTION_ID);
    expect(answer?.text).not.toContain("hunter2");
    const only: UiFormBlock = { ...login, fields: [{ id: "password", kind: "text", label: "Пароль", secret: true }] };
    expect(uiBlockResponseFromAnswers(only, { password: ["hunter2"] })).toEqual({
      actionId: "submit",
      values: { password: "hunter2" },
    });
  });
});
