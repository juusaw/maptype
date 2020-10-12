import { processTypes, TypeMap } from ".";
import { defaultConfig, DEFAULT_FILE_NAME } from "./config";
import { extractFlags } from "./flags";

describe("Generate io-ts validators (ts-to-io)", () => {
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
    stringIndexObject: a => `t.record(t.string, ${a()})`,
    numberIndexObject: a => `t.record(t.number, ${a()})`,
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
    function: () => "t.Function",
    record: ({ key, value }) => `t.record(${key()}, ${value()})`,
    array: a => `t.array(${a()})`,
    union: a => `t.union([${a.map(f => f()).join(", ")}])`,
    intersection: a => `t.intersection([${a.map(f => f()).join(", ")}])`,
    tuple: a => `t.tuple([${a.map(f => f()).join(", ")}])`
  };

  const getValidatorsFromString = (source: string) =>
    processTypes(typeMap, source).map(
      ([name, val]) => `const ${name} = ${val}`
    )[0];

  test("ts-to-io", () => {
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
      ["Y", "t.tuple([t.boolean, t.boolean])"],
      ["Z", "t.union([t.undefined, t.null])"],
      ["L", 't.union([t.literal("a"), t.literal("b")])'],
      ["B", "t.union([t.literal(0), t.literal(1)])"]
    ]);
  });

  test("generates validators for primitive types", () => {
    expect(getValidatorsFromString("type num = number;")).toBe(
      "const num = t.number"
    );
    expect(getValidatorsFromString("type str = string;")).toBe(
      "const str = t.string"
    );
    expect(getValidatorsFromString("type nil = null;")).toBe(
      "const nil = t.null"
    );
  });

  test("generates validators for basic interfaces and object types", () => {
    const inputInterface = `
    interface Test { foo: number, bar: string }
  `;
    const inputObjectType = `
    type Test = { foo: number, bar: string }
  `;
    const result = "const Test = t.type({foo: t.number, bar: t.string})";

    expect(getValidatorsFromString(inputInterface)).toBe(result);
    expect(getValidatorsFromString(inputObjectType)).toBe(result);
  });

  test("generates validators for interfaces with optional fields", () => {
    expect(
      getValidatorsFromString("interface Test { foo: string, bar?: number }")
    ).toBe(
      "const Test = t.intersection([t.type({foo: t.string}), t.partial({bar: t.union([t.undefined, t.number])})])"
    );
  });

  test("generates validators for arrays", () => {
    expect(getValidatorsFromString("type arr = string[]")).toBe(
      "const arr = t.array(t.string)"
    );
    expect(getValidatorsFromString("type arr = Array<{foo: string}>")).toBe(
      "const arr = t.array(t.type({foo: t.string}))"
    );
  });

  test("generates validators for record types", () => {
    expect(getValidatorsFromString("type rec = Record<number, string>")).toBe(
      "const rec = t.record(t.number, t.string)"
    );
    expect(getValidatorsFromString("type rec = Record<string, null>")).toBe(
      "const rec = t.record(t.string, t.null)"
    );
  });

  test("generates validators for union types", () => {
    expect(getValidatorsFromString("type un = string | number")).toBe(
      "const un = t.union([t.string, t.number])"
    );
    expect(
      getValidatorsFromString("type un = string | number | { foo: string }")
    ).toBe("const un = t.union([t.string, t.number, t.type({foo: t.string})])");
  });

  // TODO
  test.skip("optimizes validator for string literal union types", () => {
    expect(getValidatorsFromString("type un = 'foo' | 'bar'")).toBe(
      'const un = t.keyof({"foo": null, "bar": null})'
    );
  });

  test("generates validators for intersection types", () => {
    expect(
      getValidatorsFromString(
        "type inter = { foo: string } | { bar: number } | { foo: number }"
      )
    ).toBe(
      "const inter = t.union([t.type({foo: t.string}), t.type({bar: t.number}), t.type({foo: t.number})])"
    );
  });

  test("generates validators for function types", () => {
    expect(getValidatorsFromString("type fn = () => void")).toBe(
      "const fn = t.Function"
    );
    expect(
      getValidatorsFromString(
        "type fn = (s: string, n: number) => (b: boolean) => object"
      )
    ).toBe("const fn = t.Function");
  });

  test("generates validators for literal types", () => {
    expect(getValidatorsFromString('type foo = "foo"')).toBe(
      'const foo = t.literal("foo")'
    );
    expect(getValidatorsFromString("type one = 1")).toBe(
      "const one = t.literal(1)"
    );
    expect(getValidatorsFromString("type f = false")).toBe(
      "const f = t.literal(false)"
    );
  });

  test("generates validators for tuple types", () => {
    expect(getValidatorsFromString("type foo = [number, string]")).toBe(
      "const foo = t.tuple([t.number, t.string])"
    );
  });

  test("handles nullable types correctly", () => {
    expect(getValidatorsFromString('type foobar = "foo" | "bar" | null')).toBe(
      'const foobar = t.union([t.null, t.literal("foo"), t.literal("bar")])'
    );
  });
});

describe("Internals", () => {
  test("gets binary flags", () => {
    expect(extractFlags(0)).toEqual([]);
    expect(extractFlags(1)).toEqual([1]);
    expect(extractFlags(10)).toEqual([8, 2]);
    expect(extractFlags(100)).toEqual([64, 32, 4]);
    expect(extractFlags(67108864)).toEqual([67108864]);
  });
});
