// Minimal types for the Node built-ins used by *.test.ts, so `tsc` passes without @types/node
// (we may not add dependencies). Tests run with `node --test`, which strips types.

declare module 'node:test' {
  export function test(name: string, fn: () => void | Promise<void>): Promise<void>;
  export function describe(name: string, fn: () => void): void;
}

declare module 'node:assert/strict' {
  type Assert = {
    (value: unknown, message?: string): void;
    ok(value: unknown, message?: string): void;
    equal(actual: unknown, expected: unknown, message?: string): void;
    deepEqual(actual: unknown, expected: unknown, message?: string): void;
  };
  const assert: Assert;
  export default assert;
}
