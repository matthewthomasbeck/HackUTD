import { describe, expect, it } from "vitest";
import { firstBalancedObject, parseReply, stripThink } from "../src/llm/parse.ts";

describe("parse.ts (agent.md 4.4)", () => {
  it("plain JSON actions", () => {
    const r = parseReply('{"actions":[{"tool":"get_board","args":{"reason":"look"}}]}');
    expect(r).toEqual({ kind: "actions", actions: [{ tool: "get_board", args: { reason: "look" } }] });
  });

  it("fenced JSON", () => {
    const r = parseReply('Here you go:\n```json\n{"actions":[{"tool":"get_board","args":{"reason":"look"}}]}\n```');
    expect(r.kind).toBe("actions");
  });

  it("JSON after a <think> block, even one with braces inside", () => {
    const r = parseReply('<think>maybe {"actions":[]} no wait</think>{"done":true,"summary":"all handled"}');
    expect(r).toEqual({ kind: "done", summary: "all handled" });
  });

  it("the {name, arguments} leak, with arguments as a string or an object", () => {
    expect(parseReply('{"name":"get_board","arguments":"{\\"reason\\":\\"x y\\"}"}')).toEqual({
      kind: "actions",
      actions: [{ tool: "get_board", args: { reason: "x y" } }],
    });
    expect(parseReply('{"name":"get_board","arguments":{"reason":"x y"}}').kind).toBe("actions");
  });

  it("garbage is an error", () => {
    expect(parseReply("I think we should help.").kind).toBe("error");
    expect(parseReply("{not json").kind).toBe("error");
    expect(parseReply("").kind).toBe("error");
    expect(parseReply('{"foo":1}').kind).toBe("error");
  });

  it("strings with braces do not break the balance", () => {
    expect(firstBalancedObject('x {"a":"}{","b":{"c":1}} y')).toBe('{"a":"}{","b":{"c":1}}');
  });

  it("an unclosed <think> drops the rest", () => {
    expect(stripThink("ok <think> still thinking")).toBe("ok");
  });
});
