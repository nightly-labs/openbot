// @vitest-environment node

import { localizeSourceText, matchingSourceKeys, sourceText, TRANSLATED_LOCALES } from "@openbot/i18n";
import { describe, expect, it } from "vitest";
import type { ThreadItem } from "../protocol";
import { toolProgressText } from "./thread-items";

/**
 * The generic steps of `toolProgressText`, one fixture per branch. A reader watches these lines
 * while a turn runs, so each must name a source key: the screen maps the English back to its key
 * and renders the reader's language (see docs/i18n.md, "Text from another process"). A literal
 * instead leaves the line in English in every language but English (#4339).
 */
/** The progress keys the generic branches above name. Each holds plain text, so none takes a value. */
const PROGRESS_KEYS = [
  "status.agent.toolStepFailed",
  "status.agent.toolResultReviewing",
  "status.agent.sourcesSearching",
  "status.agent.sourcesReviewing",
  "status.agent.informationGathering",
  "status.agent.informationReviewing",
  "status.agent.workChecking",
  "status.agent.workReviewing",
  "status.agent.changesMaking",
  "status.agent.changesReviewing",
  "status.agent.agentCoordinating",
  "status.agent.agentResponseReviewing",
  "status.agent.toolStepWorking",
] as const;

type ProgressKey = (typeof PROGRESS_KEYS)[number];

const GENERIC_STEPS: ReadonlyArray<{
  item: ThreadItem;
  running: ProgressKey;
  completed: ProgressKey;
}> = [
  {
    item: { type: "commandexecution", command: "ls" },
    running: "status.agent.toolStepWorking",
    completed: "status.agent.toolResultReviewing",
  },
  {
    item: { type: "websearch", query: "openbot release", status: "failed" },
    running: "status.agent.sourcesSearching",
    completed: "status.agent.toolStepFailed",
  },
  {
    item: { type: "websearch", query: "openbot release" },
    running: "status.agent.sourcesSearching",
    completed: "status.agent.sourcesReviewing",
  },
  {
    item: { type: "toolCall", name: "read_file" },
    running: "status.agent.informationGathering",
    completed: "status.agent.informationReviewing",
  },
  {
    item: { type: "toolCall", name: "run_tests" },
    running: "status.agent.workChecking",
    completed: "status.agent.workReviewing",
  },
  {
    item: { type: "filechange", path: "src/index.ts" },
    running: "status.agent.changesMaking",
    completed: "status.agent.changesReviewing",
  },
  {
    item: { type: "toolCall", name: "delegate_to_agent" },
    running: "status.agent.agentCoordinating",
    completed: "status.agent.agentResponseReviewing",
  },
];

describe("tool progress text", () => {
  it("names each generic step with its own source key", () => {
    for (const step of GENERIC_STEPS) {
      for (const [completed, key] of [
        [false, step.running],
        [true, step.completed],
      ] as const) {
        const text = toolProgressText(step.item, completed);
        expect(text).toBe(sourceText(key));
        // The screen matches the English back to the key. Two matches, or none, leave it in English.
        expect(matchingSourceKeys(text ?? "")).toEqual([key]);
      }
    }
  });

  it("translates each progress line in every language", () => {
    for (const step of GENERIC_STEPS) {
      for (const key of [step.running, step.completed] as const) {
        const english = sourceText(key);
        for (const locale of TRANSLATED_LOCALES) {
          if (locale === "en") continue;
          expect(localizeSourceText(english, locale), `${key} in ${locale}`).not.toBe(english);
        }
      }
    }
  });
});
