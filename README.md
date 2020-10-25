# maptype

Maptype extracts a value from TypeScript types. The library is intended to be used as a part of a pre-processing step, not at application runtime.

## Usage

`npm install maptype`

In code:

```ts
import { processTypes } from 'maptype'

const typemap = {
  ...
}

const source = `...`

processTypes(typemap, source)
```

## Typemap

Typemap is an object that specifies the processing step of different type nodes. Maptype uses the typemap to collect a result from each type it encounters in the source string. See `src/index.spec.ts` for an example of a typemap that defines a specific string representation for types.
