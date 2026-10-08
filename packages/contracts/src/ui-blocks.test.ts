import { describe, expect, it } from "vitest";
import { INPUT_LIMITS } from "./input-limits";
import { isAgentPromptQuestion } from "./ipc-conversation-messages";
import {
  type ConversationUiBlock,
  isConversationUiBlock,
  isUiBlockId,
  isUiBlockSpec,
  normalizeUiBlockSpec,
  UI_BLOCK_LIMITS,
  UI_BLOCK_TEXT_ACTION_ID,
  type UiAlertBlock,
  type UiBlockingBlockSpec,
  type UiBlockSpec,
  type UiCanvasBlock,
  type UiChoiceBlock,
  type UiConfirmBlock,
  type UiFormBlock,
  type UiLayoutBlock,
  type UiNode,
  type UiProgressBlock,
  type UiQuickRepliesBlock,
  type UiTableBlock,
  uiBlockActionIsPrivileged,
  uiBlockAnswersFromResponse,
  uiBlockFallbackQuestions,
  uiBlockFallbackText,
  uiBlockItemType,
  uiBlockOutcomeText,
  uiBlockResponseFromAnswers,
  validateUiBlockResponse,
} from "./ui-blocks";

// The specs of the approved demo (agent-ui-blocks.html). Differences from the demo, on purpose:
// the layout `site` primitive is `status`; the form `select` field has options (a select needs them);
// demo-only keys (`notify`, the progress `id`, the canvas `html`) are kept to prove they are ignored.
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

const alert = {
  type: "alert",
  severity: "critical",
  title: "5lb.ru не отвечает",
  subtitle: "3 проверки подряд · с 20:42",
  stats: [
    { label: "Ответ", value: "502", tone: "bad" },
    { label: "Обычно", value: "290 мс" },
    { label: "Простой", value: "6 мин" },
  ],
  sparkline: [300, 290, 310, 295, 305, 290, null],
  actions: [
    { id: "restart", label: "Перезапустить", style: "primary", confirm: true },
    { id: "logs", label: "Логи" },
    { id: "mute", label: "Тише на час" },
    { id: "ack", label: "Я разберусь", style: "ghost" },
  ],
  notify: "push",
};

const progress = {
  type: "progress",
  id: "export-sept",
  title: "Выгрузка чеков за сентябрь",
  steps: [
    { label: "Подключение к 1С", state: "done" },
    { label: "Сверка возвратов", state: "running" },
    { label: "Отчёт в таблицу", state: "todo" },
  ],
  actions: [{ id: "stop", label: "Остановить", style: "danger" }],
};

const table: UiTableBlock = {
  type: "table",
  title: "Счета, которые ждут оплаты",
  columns: ["Кому", "За что", "Срок", { label: "Сумма", align: "right" }],
  rows: [
    { id: "tw", cells: ["Timeweb", "Хостинг 5lb.ru", "12 окт", "2 490 ₽"] },
    { id: "cf", cells: ["Cloudflare", "Домен | mda.ru", "15 окт", "1 100 ₽"] },
  ],
  rowAction: { id: "paid", label: "Оплачено" },
};

const layout: UiLayoutBlock = {
  type: "layout",
  root: {
    type: "column",
    children: [
      {
        type: "row",
        justify: "between",
        children: [
          {
            type: "column",
            gap: 2,
            children: [
              { type: "heading", text: "Сайты и сервисы" },
              { type: "muted", text: "Проверка каждые 5 минут · обновлено 20:52" },
            ],
          },
          { type: "pill", tone: "bad", text: "1 не отвечает" },
        ],
      },
      { type: "segmented", id: "group", options: ["Сайты", "ПК", "Связи ботов"], value: "Сайты" },
      {
        type: "grid",
        children: [
          { type: "status", name: "5lb.ru", status: "down", value: "502 · 6 мин" },
          { type: "status", name: "shop.5lb.ru", status: "ok", value: "280 мс · 99,98%" },
          { type: "status", name: "crm.5lb.ru", status: "warn", value: "1 840 мс · медленно" },
        ],
      },
      { type: "divider" },
      { type: "switch", id: "night", label: "Будить ночью, если сайт упал", value: false },
      { type: "switch", id: "slow", label: "Сообщать о медленных ответах", value: true },
      {
        type: "slider",
        id: "limit",
        label: "Медленно — это дольше",
        min: 500,
        max: 5000,
        step: 100,
        value: 1500,
        unit: "мс",
      },
      {
        type: "row",
        children: [
          { type: "button", id: "save", label: "Сохранить", style: "primary" },
          { type: "button", id: "check", label: "Проверить сейчас" },
        ],
      },
    ],
  },
};

const canvas = { type: "canvas", title: "Письма по часам", height: 312, html: "<!doctype html>… код агента …" };

const DEMO_SPECS = {
  confirm,
  quickReplies,
  choice,
  form,
  alert,
  progress,
  table,
  layout,
  canvas,
};

function spec<T extends UiBlockSpec>(value: unknown): T {
  const normalized = normalizeUiBlockSpec(value);
  if (!normalized) throw new Error("invalid spec");
  // biome-ignore lint/nursery/noUnsafeTypeAssertion: a test fixture of a known type
  return normalized as T;
}

function nest(depth: number): UiNode {
  return depth <= 1 ? { type: "text", text: "leaf" } : { type: "column", children: [nest(depth - 1)] };
}

describe("ui block specs", () => {
  it.each(Object.entries(DEMO_SPECS))("accepts the demo %s block", (_, value) => {
    expect(isUiBlockSpec(value)).toBe(true);
  });

  it("drops keys it does not know", () => {
    expect(normalizeUiBlockSpec(alert)).not.toHaveProperty("notify");
    expect(normalizeUiBlockSpec(progress)).not.toHaveProperty("id");
    expect(normalizeUiBlockSpec(canvas)).toEqual({ type: "canvas", title: "Письма по часам", height: 312 });
    expect(normalizeUiBlockSpec(confirm)).toEqual(confirm);
    expect(normalizeUiBlockSpec(layout)).toEqual(layout);
  });

  it("rejects an unknown type and the old site primitive", () => {
    expect(isUiBlockSpec({ ...confirm, type: "dialog" })).toBe(false);
    expect(isUiBlockSpec({ type: "layout", root: { type: "site", name: "a", status: "ok" } })).toBe(false);
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
    expect(isUiBlockSpec({ ...alert, severity: "fatal" })).toBe(false);
    expect(isUiBlockSpec({ ...alert, sparkline: [1, Number.NaN] })).toBe(false);
    expect(isUiBlockSpec({ ...table, rows: [{ id: "x", cells: ["one"] }] })).toBe(false);
    expect(isUiBlockSpec({ ...progress, percent: 101 })).toBe(false);
    expect(isUiBlockSpec({ ...progress, steps: [{ label: "a", state: "paused" }] })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "d", kind: "date", label: "D", value: "2026-02-30" }] })).toBe(
      false,
    );
    expect(isUiBlockSpec({ ...form, fields: [{ id: "s", kind: "select", label: "S", options: [] }] })).toBe(false);
    expect(isUiBlockSpec({ ...form, fields: [{ id: "s", kind: "select", options: ["a"], value: "b" }] })).toBe(false);
    expect(isUiBlockSpec({ type: "layout", root: { type: "slider", id: "s", label: "S", min: 5, max: 1 } })).toBe(
      false,
    );
    expect(isUiBlockSpec({ ...canvas, height: 10 })).toBe(false);
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
    expect(isUiBlockSpec({ ...table, rows: [table.rows[0], table.rows[0]] })).toBe(false);
    expect(
      isUiBlockSpec({
        type: "layout",
        root: {
          type: "row",
          children: [
            { type: "switch", id: "x", label: "X" },
            { type: "button", id: "x", label: "Go" },
          ],
        },
      }),
    ).toBe(false);
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
    const rows = Array.from({ length: UI_BLOCK_LIMITS.tableRows + 1 }, (_, index) => ({
      id: `r${index}`,
      cells: ["a", "b", "c", "d"],
    }));
    expect(isUiBlockSpec({ ...table, rows })).toBe(false);
    // The JSON limit holds even when each field is within its own limit.
    expect(isUiBlockSpec({ ...canvas, html: "x".repeat(UI_BLOCK_LIMITS.specJson) })).toBe(false);
  });

  it("bounds the layout depth and node count", () => {
    expect(isUiBlockSpec({ type: "layout", root: nest(UI_BLOCK_LIMITS.layoutDepth) })).toBe(true);
    expect(isUiBlockSpec({ type: "layout", root: nest(UI_BLOCK_LIMITS.layoutDepth + 1) })).toBe(false);
    const leaves = (count: number): UiNode => ({
      type: "column",
      children: Array.from({ length: count }, () => ({ type: "divider" }) as const),
    });
    expect(isUiBlockSpec({ type: "layout", root: leaves(UI_BLOCK_LIMITS.layoutNodes - 1) })).toBe(true);
    expect(isUiBlockSpec({ type: "layout", root: leaves(UI_BLOCK_LIMITS.layoutNodes) })).toBe(false);
  });

  it("names the item type of a display block", () => {
    expect(uiBlockItemType("progress")).toBe("ui-block:progress");
  });
});

describe("ui block responses", () => {
  const confirmSpec = spec<UiConfirmBlock>(confirm);
  const alertSpec = spec<UiAlertBlock>(alert);
  const progressSpec = spec<UiProgressBlock>(progress);
  const canvasSpec = spec<UiCanvasBlock>(canvas);

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
    expect(validateUiBlockResponse(alertSpec, { actionId: "restart", approved: true })).not.toBeNull();
    expect(validateUiBlockResponse(table, { actionId: "paid", rowId: "tw" })).not.toBeNull();
    expect(validateUiBlockResponse(progressSpec, { actionId: "stop" })).not.toBeNull();
    expect(
      validateUiBlockResponse(layout, { actionId: "save", values: { group: "ПК", night: true, limit: 2000 } }),
    ).not.toBeNull();
    expect(
      validateUiBlockResponse(canvasSpec, { actionId: "pick", values: { hour: 14, tags: ["a", "b"], ok: true } }),
    ).not.toBeNull();
  });

  it("drops keys it does not know", () => {
    expect(validateUiBlockResponse(alertSpec, { actionId: "logs", extra: 1 })).toEqual({ actionId: "logs" });
  });

  it("rejects unknown ids", () => {
    expect(validateUiBlockResponse(confirmSpec, { actionId: "delete" })).toBeNull();
    expect(validateUiBlockResponse(confirmSpec, { actionId: "send", values: { to: "x" } })).toBeNull();
    expect(validateUiBlockResponse(quickReplies, { actionId: "never" })).toBeNull();
    expect(validateUiBlockResponse(choice, { actionId: "submit", values: { selected: ["nobody"] } })).toBeNull();
    expect(validateUiBlockResponse(form, { actionId: "submit", values: { what: "x", extra: "y" } })).toBeNull();
    expect(validateUiBlockResponse(table, { actionId: "paid", rowId: "nope" })).toBeNull();
    expect(validateUiBlockResponse(table, { actionId: "paid" })).toBeNull();
    expect(validateUiBlockResponse(alertSpec, { actionId: "logs", rowId: "tw" })).toBeNull();
    expect(validateUiBlockResponse(layout, { actionId: "save", values: { unknown: 1 } })).toBeNull();
    expect(validateUiBlockResponse(layout, { actionId: "group" })).toBeNull();
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
    expect(validateUiBlockResponse(layout, { actionId: "save", values: { limit: 9000 } })).toBeNull();
    expect(validateUiBlockResponse(layout, { actionId: "save", values: { night: "yes" } })).toBeNull();
    expect(validateUiBlockResponse(alertSpec, { actionId: "logs", values: { a: "b" } })).toBeNull();
    expect(validateUiBlockResponse(canvasSpec, { actionId: "pick", values: { nested: { a: 1 } } })).toBeNull();
  });

  it("takes words only for a blocking block", () => {
    expect(
      validateUiBlockResponse(confirmSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "Пока нет" }),
    ).not.toBeNull();
    expect(validateUiBlockResponse(confirmSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID })).toBeNull();
    expect(validateUiBlockResponse(alertSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "ok" })).toBeNull();
    expect(validateUiBlockResponse(canvasSpec, { actionId: UI_BLOCK_TEXT_ACTION_ID, text: "ok" })).toBeNull();
    expect(validateUiBlockResponse(alertSpec, { actionId: "logs", text: "ok" })).toBeNull();
  });

  it("bounds the response size", () => {
    expect(
      validateUiBlockResponse(form, {
        actionId: "submit",
        values: { what: "x".repeat(UI_BLOCK_LIMITS.fieldValue + 1) },
      }),
    ).toBeNull();
    const values = Object.fromEntries(
      Array.from({ length: UI_BLOCK_LIMITS.canvasValues }, (_, index) => [`k${index}`, "x".repeat(1_000)]),
    );
    expect(validateUiBlockResponse(canvasSpec, { actionId: "pick", values })).toBeNull();
  });

  it("marks danger and confirm actions as privileged", () => {
    expect(uiBlockActionIsPrivileged(confirmSpec, "send")).toBe(true);
    expect(uiBlockActionIsPrivileged(confirmSpec, "cancel")).toBe(false);
    expect(uiBlockActionIsPrivileged({ ...confirmSpec, danger: false }, "send")).toBe(false);
    expect(uiBlockActionIsPrivileged(alertSpec, "restart")).toBe(true);
    expect(uiBlockActionIsPrivileged(alertSpec, "logs")).toBe(false);
    expect(uiBlockActionIsPrivileged(progressSpec, "stop")).toBe(true);
    expect(uiBlockActionIsPrivileged(layout, "save")).toBe(false);
    expect(uiBlockActionIsPrivileged(table, "paid")).toBe(false);
  });
});

describe("ui block fallbacks", () => {
  const blocking: UiBlockingBlockSpec[] = [spec(confirm), quickReplies, choice, form];

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
    const [action, from] = uiBlockFallbackQuestions(spec<UiConfirmBlock>(confirm));
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
    const confirmSpec = spec<UiConfirmBlock>(confirm);
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
    const cases: Array<[UiBlockingBlockSpec, unknown]> = [
      [spec(confirm), { actionId: "send", values: { from: "nekitterekhin@gmail.com" } }],
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

  it("writes display blocks as readable text", () => {
    const alertText = uiBlockFallbackText(spec(alert));
    expect(alertText).toContain("**Critical: 5lb.ru не отвечает**");
    expect(alertText).toContain("- Ответ: 502");
    expect(alertText).toContain("Actions: Перезапустить · Логи · Тише на час · Я разберусь");
    const tableText = uiBlockFallbackText(table);
    expect(tableText).toContain("| Кому | За что | Срок | Сумма |");
    expect(tableText).toContain("| --- | --- | --- | ---: |");
    expect(tableText).toContain("Домен \\| mda.ru");
    const progressText = uiBlockFallbackText(spec(progress));
    expect(progressText).toContain("- [x] Подключение к 1С");
    expect(progressText).toContain("- [ ] Сверка возвратов (running)");
    const layoutText = uiBlockFallbackText(layout);
    expect(layoutText).toContain("**Сайты и сервисы**");
    expect(layoutText).toContain("- 5lb.ru: down · 502 · 6 мин");
    expect(layoutText).toContain("- Медленно — это дольше: 1500 мс");
    expect(layoutText).toContain("Actions: Сохранить · Проверить сейчас");
    expect(uiBlockFallbackText(spec(canvas))).toContain("Письма по часам");
    for (const value of Object.values(DEMO_SPECS)) expect(uiBlockFallbackText(spec(value)).trim()).not.toBe("");
  });

  it("describes the outcome of a response", () => {
    expect(uiBlockOutcomeText(spec(confirm), { actionId: "send", values: { from: "a@b.c" } })).toBe(
      "Отправить · a@b.c",
    );
    expect(uiBlockOutcomeText(choice, { actionId: "submit", values: { selected: ["protein90", "vvo"] } })).toBe(
      "Покупали протеин за 90 дней, Только Владивосток",
    );
    expect(uiBlockOutcomeText(table, { actionId: "paid", rowId: "tw" })).toBe("Оплачено: Timeweb");
    expect(uiBlockOutcomeText(form, { actionId: "submit", values: { what: "Кран", urgency: "Высокая" } })).toBe(
      "Что случилось: Кран; urgency: Высокая",
    );
  });
});

describe("conversation ui blocks", () => {
  const sender = { id: "member-1", name: "Никита" };
  const answered: ConversationUiBlock = {
    version: 1,
    blockId: "mail-tsj",
    spec: spec(confirm),
    state: {
      status: "answered",
      response: { actionId: "send", values: { from: "sysrootix@gmail.com" } },
      respondedBy: sender,
      respondedAt: "2026-10-08T10:00:00.000Z",
      outcome: "Отправить · sysrootix@gmail.com",
    },
  };

  it("accepts a pending, an answered and a logged block", () => {
    expect(isConversationUiBlock({ version: 1, blockId: "b1", spec: quickReplies, state: { status: "pending" } })).toBe(
      true,
    );
    expect(isConversationUiBlock(answered)).toBe(true);
    expect(
      isConversationUiBlock({
        version: 1,
        blockId: "bills",
        spec: table,
        state: { status: "pending", log: [{ actionId: "paid", rowId: "tw", at: "2026-10-08T10:00:00Z", by: sender }] },
      }),
    ).toBe(true);
    for (const status of ["expired", "closed"]) {
      expect(isConversationUiBlock({ ...answered, state: { status } })).toBe(true);
    }
  });

  it("fails closed on a broken block", () => {
    expect(isConversationUiBlock({ ...answered, version: 2 })).toBe(false);
    expect(isConversationUiBlock({ ...answered, blockId: "" })).toBe(false);
    expect(isConversationUiBlock({ ...answered, spec: { ...confirm, type: "nope" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "open" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "answered" } })).toBe(false);
    expect(isConversationUiBlock({ ...answered, state: { status: "answered", response: { actionId: "nope" } } })).toBe(
      false,
    );
    expect(isConversationUiBlock({ ...answered, state: { ...answered.state, respondedBy: { id: "" } } })).toBe(false);
    expect(
      isConversationUiBlock({
        ...answered,
        state: { status: "pending", log: [{ actionId: "send", at: "2026-10-08T10:00:00Z" }] },
      }),
    ).toBe(false);
    expect(
      isConversationUiBlock({
        version: 1,
        blockId: "bills",
        spec: table,
        state: {
          status: "pending",
          log: Array.from({ length: UI_BLOCK_LIMITS.actionLog + 1 }, () => ({
            actionId: "paid",
            rowId: "tw",
            at: "t",
          })),
        },
      }),
    ).toBe(false);
  });
});
