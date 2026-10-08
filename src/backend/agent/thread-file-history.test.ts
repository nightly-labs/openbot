import { join, resolve } from "node:path";
import { expect, it } from "vitest";
import { ThreadFileHistory } from "./thread-file-history";

it("keeps the latest 200 absolute paths within their agent and thread", () => {
  const history = new ThreadFileHistory();
  const root = resolve("history-fixture");
  const paths = Array.from({ length: 201 }, (_, index) => join(root, `${index}.txt`));
  history.record("agent", "thread", paths);
  history.record("agent", "thread", [paths[1], "relative.txt", null]);
  expect(history.paths("agent", "thread")).toEqual([...paths.slice(2), paths[1]]);
  expect(history.paths("other-agent", "thread")).toEqual([]);
  expect(history.paths("agent", "other-thread")).toEqual([]);
  history.record("other-agent", "other-thread", [join(root, "other.txt")]);
  history.forgetAgent("agent");
  expect(history.paths("agent", "thread")).toEqual([]);
  expect(history.paths("other-agent", "other-thread")).toEqual([join(root, "other.txt")]);
  history.clear();
  expect(history.paths("other-agent", "other-thread")).toEqual([]);
});
