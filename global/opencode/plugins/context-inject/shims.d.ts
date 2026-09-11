// shims.d.ts — type-only ambient shims so `tsc -p .` passes without
// @types/node. Dev-time metadata: the installer copies this folder as-is, and
// `npm publish` excludes it via package.json `files`; the real contracts
// belong to the runtime — these declarations exist purely for local type
// checking and are intentionally permissive.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function existsSync(path: string): boolean;
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void;
  export function appendFileSync(path: string, data: string): void;
}

declare module "node:os" {
  export function homedir(): string;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function dirname(path: string): string;
  export function isAbsolute(path: string): boolean;
  export function normalize(path: string): string;
}

declare module "node:url" {
  export function fileURLToPath(url: string | URL): string;
}

declare const process: {
  cwd(): string;
};
