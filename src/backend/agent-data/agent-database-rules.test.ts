import { describe, expect, it } from "vitest";
import { checkAgentParameters, checkAgentSql, schemaChange } from "./agent-database-rules";

describe("checkAgentSql", () => {
  it("accepts reads in read mode and writes in write mode", () => {
    expect(checkAgentSql("SELECT * FROM people", "read").ok).toBe(true);
    expect(checkAgentSql("VALUES (1)", "read").ok).toBe(true);
    expect(checkAgentSql("INSERT INTO people (name) VALUES (?)", "write").ok).toBe(true);
    expect(checkAgentSql("CREATE TABLE people (id INTEGER PRIMARY KEY)", "write").ok).toBe(true);
  });

  it("names the other tool when a statement is sent to the wrong one", () => {
    const write = checkAgentSql("DELETE FROM people", "read");
    expect(write.ok).toBe(false);
    expect(write.ok || write.message).toContain("execute_data");
    const read = checkAgentSql("SELECT 1", "write");
    expect(read.ok || read.message).toContain("query_data");
  });

  it("reads the statement kind at the end of a WITH clause, not inside it", () => {
    expect(checkAgentSql("WITH recent AS (SELECT 1) DELETE FROM people", "read").ok).toBe(false);
    expect(checkAgentSql("WITH recent AS (SELECT 1) DELETE FROM people", "write").ok).toBe(true);
    expect(checkAgentSql("WITH recent AS (SELECT 1) SELECT * FROM recent", "read").ok).toBe(true);
  });

  it("does not mistake a semicolon inside a string, an identifier, or a comment for a second statement", () => {
    expect(checkAgentSql("SELECT ';' AS marker", "read").ok).toBe(true);
    expect(checkAgentSql("SELECT '--' AS marker", "read").ok).toBe(true);
    expect(checkAgentSql("SELECT 'it''s; fine' AS marker", "read").ok).toBe(true);
    expect(checkAgentSql("/* ; */ SELECT 1", "read").ok).toBe(true);
    expect(checkAgentSql("SELECT 1 -- ; DROP TABLE people", "read").ok).toBe(true);
    expect(checkAgentSql("SELECT x'3b' AS marker", "read").ok).toBe(true);
    expect(checkAgentSql('SELECT "a;b" FROM people', "read").ok).toBe(true);
  });

  it("rejects a second statement, which prepare() would silently discard", () => {
    const result = checkAgentSql("INSERT INTO people (name) VALUES ('a'); DROP TABLE people", "write");
    expect(result.ok).toBe(false);
    expect(result.ok || result.message).toContain("one SQL statement");
  });

  it("rejects an unterminated string or comment", () => {
    expect(checkAgentSql("SELECT 'open", "read").ok).toBe(false);
    expect(checkAgentSql("/* open SELECT 1", "read").ok).toBe(false);
  });

  it.each([
    ["ATTACH DATABASE '/tmp/x.db' AS x", "already in the one shared database"],
    ["PRAGMA journal_mode", "list_tables"],
    ["BEGIN", "one statement in its own transaction"],
    ["VACUUM", "VACUUM is not available."],
  ])("refuses %j with an alternative", (sql, expected) => {
    const result = checkAgentSql(sql, "write");
    expect(result.ok).toBe(false);
    expect(result.ok || result.message).toContain(expected);
  });

  it("rejects a statement past the length cap", () => {
    expect(checkAgentSql(`SELECT '${"x".repeat(20_001)}'`, "read").ok).toBe(false);
  });
});

describe("schemaChange", () => {
  it("tells a statement that changes the schema from one that only changes rows", () => {
    expect(schemaChange("CREATE TABLE people (id INTEGER PRIMARY KEY)")).toBe("create");
    expect(schemaChange("/* note */ DROP TABLE people")).toBe("drop");
    expect(schemaChange("ALTER TABLE people ADD COLUMN email TEXT")).toBe("alter");
    expect(schemaChange("INSERT INTO people (name) VALUES (?)")).toBeNull();
  });
});

describe("checkAgentParameters", () => {
  it("accepts the types a model can send and converts a boolean", () => {
    expect(checkAgentParameters(["a", 1, true, false, null])).toEqual({ ok: true, value: ["a", 1, 1, 0, null] });
    expect(checkAgentParameters(undefined)).toEqual({ ok: true, value: [] });
  });

  it.each([
    ["an object instead of an array", { name: "a" }],
    ["a nested object", [{ nested: true }]],
    ["a value that is not finite", [Number.NaN]],
    ["more parameters than the cap", Array.from({ length: 101 }, () => 1)],
    ["more bytes than the cap", ["x".repeat(1_000_001)]],
  ])("rejects %s", (_label, value) => {
    expect(checkAgentParameters(value).ok).toBe(false);
  });
});
