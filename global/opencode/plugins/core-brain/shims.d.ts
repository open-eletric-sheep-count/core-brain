// shims.d.ts — type-only ambient shims so `tsc -p .` passes without
// @types/node and without the host's runtime packages. Dev-time metadata:
// the installer copies this folder as-is, and `npm publish` excludes it via
// package.json `files`; the real contracts belong to the host — these
// declarations exist purely for local type checking and are intentionally
// permissive.

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
}

declare module "node:crypto" {
  export function randomUUID(): string;
}

declare const process: {
  env: Record<string, string | undefined>;
  cwd(): string;
};
