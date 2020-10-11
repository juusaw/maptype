import * as ts from "typescript";
import {
  isPrimitiveType,
  isStringIndexedObjectType,
  isRecordType,
  isNumberIndexedType,
  isTupleType,
  isArrayType,
  isObjectType,
  isAnyOrUnknown,
  isVoid,
  isFunctionType,
  isBasicObjectType,
  isLiteralType,
} from "./type";
import { extractFlags } from "./flags";
import { defaultConfig, TsToIoConfig, DEFAULT_FILE_NAME } from "./config";

type ObjectKeyType = string | number | symbol;

export interface TypeMap<R> {
  literal: (val: boolean | number | string) => R;
  void: () => R;
  string: () => R;
  number: () => R;
  boolean: () => R;
  null: () => R;
  undefined: () => R;
  any: () => R;
  unknown: () => R;
  emptyObject: () => R;
  stringIndexObject: (a: () => R) => R;
  numberIndexObject: (a: () => R) => R;
  object: (a: {
    properties: Array<[ObjectKeyType, () => R]>;
    optionalProperties: Array<[ObjectKeyType, () => R]>;
  }) => R;
  function: (a: { args: Array<() => R>; return: () => R }) => R;
  record: (a: { key: () => R; value: () => R }) => R;
  array: (a: () => R) => R;
  union: (a: Array<() => R>) => R;
  intersection: (a: Array<() => R>) => R;
  tuple: (a: Array<() => R>) => R;
}

const processProperty = <R>(typemap: TypeMap<R>) => (
  checker: ts.TypeChecker
) => (s: ts.Symbol): R => {
  return processType(typemap)(checker)(
    checker.getTypeOfSymbolAtLocation(s, s.valueDeclaration)
  );
};

const processObjectType = <R>(typemap: TypeMap<R>) => (
  checker: ts.TypeChecker
) => (type: ts.ObjectType): R => {
  const properties = checker.getPropertiesOfType(type);
  const propertyProcessor = processProperty(typemap)(checker);
  // TODO: Maybe use a partition function?
  const requiredProperties = properties.filter(
    (p) => !(p.valueDeclaration as ts.ParameterDeclaration).questionToken
  );
  const optionalProperties = properties.filter(
    (p) => (p.valueDeclaration as ts.ParameterDeclaration).questionToken
  );
  return typemap.object({
    properties: requiredProperties.map((p) => [
      p.name,
      () => propertyProcessor(p),
    ]),
    optionalProperties: optionalProperties.map((p) => [
      p.name,
      () => propertyProcessor(p),
    ]),
  });
};

const processType = <R>(typemap: TypeMap<R>) => (checker: ts.TypeChecker) => (
  type: ts.Type
): R => {
  if (isLiteralType(type)) {
    // TODO: What if non-string literal?
    return typemap.literal(checker.typeToString(type));
  } else if (isPrimitiveType(type)) {
    switch (checker.typeToString(type)) {
      case "string":
        return typemap.string();
      case "number":
        return typemap.number();
      case "boolean":
        return typemap.boolean();
      case "null":
        return typemap.null();
      case "undefined":
        return typemap.undefined();
      default:
        throw Error("Unknown primitive type");
    }
  } else if (isBasicObjectType(type, checker)) {
    return typemap.emptyObject();
  } else if (isRecordType(type)) {
    const [key, value] = type.aliasTypeArguments!;
    return typemap.record({
      key: () => processType(typemap)(checker)(key),
      value: () => processType(typemap)(checker)(value),
    });
  } else if (type.isUnion()) {
    return typemap.union(
      type.types.map((type) => () => processType(typemap)(checker)(type))
    );
  } else if (type.isIntersection()) {
    return typemap.intersection(
      type.types.map((type) => () => processType(typemap)(checker)(type))
    );
  } else if (isTupleType(type, checker)) {
    if (type.hasRestElement) {
      // TODO
      console.warn("Tuple rest elements are not currently supported");
    }
    return typemap.tuple(
      (type as ts.TupleType).typeArguments!.map((type) => () =>
        processType(typemap)(checker)(type)
      )
    );
  } else if (isArrayType(type, checker)) {
    return typemap.array(() =>
      processType(typemap)(checker)(type.getNumberIndexType()!)
    );
  } else if (isStringIndexedObjectType(type)) {
    return typemap.stringIndexObject(() =>
      processType(typemap)(checker)(type.getStringIndexType()!)
    );
  } else if (isNumberIndexedType(type)) {
    return typemap.numberIndexObject(() =>
      processType(typemap)(checker)(type.getStringIndexType()!)
    );
  } else if (isFunctionType(type)) {
    // TODO handle args and return
    return typemap.function({ args: [], return: null as any });
  } else if (isObjectType(type)) {
    return processObjectType(typemap)(checker)(type);
  } else if (isVoid(type)) {
    return typemap.void();
  } else if (isAnyOrUnknown(type)) {
    return typemap.unknown();
  }
  throw Error("Unknown type with type flags: " + extractFlags(type.flags));
};

function handleDeclaration<R>(
  typemap: TypeMap<R>,
  node:
    | ts.TypeAliasDeclaration
    | ts.InterfaceDeclaration
    | ts.VariableStatement,
  checker: ts.TypeChecker
): [string, R] {
  let symbol, type;
  try {
    if (node.kind === ts.SyntaxKind.VariableStatement) {
      symbol = checker.getSymbolAtLocation(
        node.declarationList.declarations[0].name
      );
      type = checker.getTypeOfSymbolAtLocation(
        symbol!,
        symbol!.valueDeclaration!
      );
    } else {
      symbol = checker.getSymbolAtLocation(node.name);
      type = checker.getTypeAtLocation(node);
    }
    return [symbol!.name, processType(typemap)(checker)(type)];
  } catch (e) {
    // TODO: What to do with errors
    throw e;
  }
}

const visit = <R>(
  typemap: TypeMap<R>,
  checker: ts.TypeChecker,
  config: TsToIoConfig,
  result: [string, R][]
) => (node: ts.Node) => {
  if (
    !config.followImports &&
    !config.fileNames.includes(node.getSourceFile().fileName)
  ) {
    return;
  }
  if (
    ts.isTypeAliasDeclaration(node) ||
    ts.isVariableStatement(node) ||
    ts.isInterfaceDeclaration(node)
  ) {
    result.push(handleDeclaration(typemap, node, checker));
  } else if (ts.isModuleDeclaration(node)) {
    ts.forEachChild(node, visit(typemap, checker, config, result));
  }
};

const compilerOptions: ts.CompilerOptions = {
  strictNullChecks: true,
};

export function processTypes<R>(
  typemap: TypeMap<R>,
  source: string,
  config = { ...defaultConfig, fileNames: [DEFAULT_FILE_NAME] }
) {
  const defaultCompilerHostOptions = ts.createCompilerHost({});

  const compilerHostOptions = {
    ...defaultCompilerHostOptions,
    getSourceFile: (
      filename: string,
      languageVersion: ts.ScriptTarget,
      ...restArgs: any[]
    ) => {
      if (filename === DEFAULT_FILE_NAME)
        return ts.createSourceFile(
          filename,
          source,
          ts.ScriptTarget.ES2015,
          true
        );
      else
        return defaultCompilerHostOptions.getSourceFile(
          filename,
          languageVersion,
          ...restArgs
        );
    },
  };

  const program = ts.createProgram(
    [DEFAULT_FILE_NAME],
    compilerOptions,
    compilerHostOptions
  );
  const checker = program.getTypeChecker();
  const result: [string, R][] = [];
  ts.forEachChild(
    program.getSourceFile(DEFAULT_FILE_NAME)!,
    visit(typemap, checker, config, result)
  );
  return result;
}
