// shims.d.ts — type-only ambient shims so `tsc -p .` passes without
// @types/node and without the host's runtime packages. Dev-time metadata:
// the installer copies this folder as-is, and `npm publish` excludes it via
// package.json `files`; the real contracts belong to the host — these
// declarations exist purely for local type checking and are intentionally
// permissive.

declare module "node:fs" {
  export function readFileSync(path: string, encoding: string): string;
  export function writeFileSync(
    path: string,
    data: string,
    encoding: string,
  ): void;
  export function renameSync(oldPath: string, newPath: string): void;
  export function unlinkSync(path: string): void;
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
}

declare module "@opencode/plugin/tui" {
  export const Plugin: { define(definition: unknown): unknown };
  // The host context shape is runtime-owned; local type checking only.
  export function usePlugin(): any;
}

declare module "solid-js" {
  export function createSignal<T>(initial: T): [() => T, (value: T) => void];
  export function onCleanup(fn: () => void): void;
  export const For: any;
  export const Show: any;
}

// OpenTUI JSX intrinsics (box / text / ScrollArea) — provided by the host
// runtime; permissive index signature for local type checking.
declare namespace JSX {
  interface Element {}
  interface IntrinsicElements {
    [element: string]: any;
  }
}
