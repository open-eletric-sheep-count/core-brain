// shims.d.ts — type-only ambient shims so `tsc -p .` passes without
// @types/node and without the host's runtime packages. Dev-time metadata:
// the installer copies this folder as-is, and `npm publish` excludes it via
// package.json `files`; the real contracts belong to the host — these
// declarations exist purely for local type checking and are intentionally
// permissive.

// Without @types/node the name is otherwise unresolved inside this file, which
// `skipLibCheck` silently turns into `any`; declaring it keeps the byte-return
// type of `readFileSync` honest.
interface Buffer extends Uint8Array {}

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function readFileSync(path: string): Buffer;
  export function writeFileSync(
    path: string,
    data: string,
    encoding: string,
  ): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function appendFileSync(path: string, data: string): void;
  export function readdirSync(path: string): string[];
  export function readdirSync(
    path: string,
    options: { withFileTypes: true },
  ): { name: string; isDirectory(): boolean }[];
  export function statSync(path: string): { isDirectory(): boolean; size: number };
  export function unlinkSync(path: string): void;
  export function rmSync(
    path: string,
    options?: { recursive?: boolean; force?: boolean },
  ): void;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function basename(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
  export function pathToFileURL(path: string): URL;
}

declare module "node:crypto" {
  // `update` returns the SAME hash so callers can chain `.update(...).digest(...)`
  // (the shape the real Node API has). Declaring it `unknown` broke the chain
  // and produced TS2571 "Object is of type 'unknown'" at the `.digest` access.
  export interface Hash {
    update(data: string | Uint8Array): Hash;
    digest(): unknown;
    digest(encoding: "hex" | "base64"): string;
  }
  export function randomUUID(): string;
  export function createHash(algorithm: string): Hash;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};

// --- Slice 1 engine additions (plan §7 Phase 1, file 1.11) ------------------
// The engine resolves its runtime at an ABSOLUTE path (D1): a `createRequire`
// anchored at the runtime dir resolves the installed package entry, which is
// then imported by URL. Neither is a compile-time dependency of this tree.

declare module "node:module" {
  export interface NodeRequire {
    (id: string): unknown;
    resolve(id: string): string;
  }
  export function createRequire(filename: string | URL): NodeRequire;
}

// The runtime is imported dynamically from an absolute path resolved at
// runtime (`createRequire(...).resolve(...)` + `import(pathToFileURL(entry).href)`);
// it is NOT resolvable from this tree. The shorthand ambient declaration types
// every import from it as `any` — the intended permissive contract for a
// runtime-only module.
declare module "@huggingface/transformers";
