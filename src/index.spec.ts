import { processTypes, TypeMap } from ".";
import { defaultConfig, DEFAULT_FILE_NAME } from "./config";

describe("Generate io-ts validators", () => {
  test("ts-to-io", () => {
    const typeMap: TypeMap<string> = {
      string: () => "t.string",
      number: () => "t.number",
      boolean: () => "t.boolean",
      literal: (val: boolean | number | string) => `t.literal(${val})`,
      null: () => "t.null",
      undefined: () => "t.undefined",
      void: () => "t.void",
      any: () => "t.any",
      unknown: () => "t.any",
      emptyObject: () => "t.type({})",
      stringIndexObject: (a) => `t.record(t.string, ${a()})`,
      numberIndexObject: (a) => `t.record(t.number, ${a()})`,
      object: ({ properties, optionalProperties }) => {
        if (properties.length && optionalProperties.length) {
          return `t.intersection([t.type({${properties.map(
            ([k, f]) => `${String(k)}: ${f()}`
          )}}), t.partial({${optionalProperties
            .map(([k, f]) => `${String(k)}: ${f()}`)
            .join(", ")}})])`;
        } else if (optionalProperties.length === 0) {
          return `t.type({${properties
            .map(([k, f]) => `${String(k)}: ${f()}`)
            .join(", ")}})`;
        } else {
          return `t.partial({${optionalProperties
            .map(([k, f]) => `${String(k)}: ${f()}`)
            .join(", ")}})`;
        }
      },
      function: () => "t.function",
      record: ({ key, value }) => `t.record(${key()}, ${value()})`,
      array: (a) => `t.array(${a})`,
      union: (a) => `t.union([${a.map((f) => f()).join(",")}])`,
      intersection: (a) => `t.intersection([${a.map((f) => f()).join(",")}])`,
      tuple: (a) => `t.tuple([${a.map((f) => f()).join(",")}])`,
    };
    const source = `
      type X = Record<string, {x: number, y: number }>
      type Y = [boolean, boolean]
      type Z = null | undefined
      type L = "a" | "b"
      type B = 0| 1
    `;
    const codecs = processTypes(typeMap, source);
    expect(codecs).toEqual([
      ["X", "t.record(t.string, t.type({x: t.number, y: t.number}))"],
      ["Y", "t.tuple([t.boolean,t.boolean])"],
      ["Z", "t.union([t.undefined,t.null])"],
      ["L", 't.union([t.literal("a"),t.literal("b")])'],
      ["B", "t.union([t.literal(0),t.literal(1)])"],
    ]);
  });
});
