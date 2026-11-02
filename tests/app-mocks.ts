import { mock } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, rmdirSync, unlinkSync, writeFileSync } from "node:fs";

type Handler = (...args: unknown[]) => void;

export class Node {
  key?: string;
  handlers: Record<string, Handler[]> = {};
  kids: Node[] = [];
  texts: string[] = [];
  calls: [string, unknown[]][] = [];
  id(value: string) {
    this.key = value;
    return this;
  }
  when(condition: unknown, branch: (el: Node) => Node) {
    return condition ? branch(this) : this;
  }
  child(value: unknown) {
    if (value instanceof Node) this.kids.push(value);
    else this.texts.push(String(value));
    return this;
  }
  children(values: unknown[]) {
    for (const value of values) this.child(value);
    return this;
  }
  listen(kind: string, handler: Handler) {
    (this.handlers[kind] ??= []).push(handler);
    return this;
  }
  on_click(handler: Handler) {
    return this.listen("click", handler);
  }
  on_mouse_down(button: string, handler: Handler) {
    return this.listen(`down:${button}`, handler);
  }
  on_mouse_up(button: string, handler: Handler) {
    return this.listen(`up:${button}`, handler);
  }
  on_mouse_move(handler: Handler) {
    return this.listen("move", handler);
  }
  on_hover(handler: Handler) {
    return this.listen("hover", handler);
  }
}

export function make(): Node {
  return new Proxy(new Node(), {
    get(target, prop, receiver) {
      if (prop in target) return Reflect.get(target, prop, receiver);
      return (...args: unknown[]) => {
        target.calls.push([String(prop), args]);
        return receiver;
      };
    },
  });
}

export const herdr: Record<string, (...args: never[]) => unknown> = {};

const HERDR = ["exec", "notify", "props", "updates", "spaces", "panes", "run", "openOverlay", "theme", "shared", "setShared", "watchFolder", "window", "nextCommand", "layout", "agents", "readTextFile", "home", "terminals"];

mock.module("gpui-kit", () => ({ View: class {}, div: make, svg: () => make() }));
mock.module("gpui-base", () => ({ v_flex: make, h_flex: make }));
mock.module("herdr", () => Object.fromEntries(HERDR.map((name) => [name, (...args: never[]) => herdr[name]?.(...args)])));
mock.module("fs/promises", () => ({
  readFile: async (path: string, encoding?: unknown) => (encoding ? readFileSync(path, "utf8") : new Uint8Array(readFileSync(path))),
  writeFile: async (path: string, contents: string | Uint8Array) => writeFileSync(path, contents),
  readdir: async (path: string, options?: { withFileTypes?: boolean }) =>
    options?.withFileTypes ? readdirSync(path, { withFileTypes: true }).map((entry) => ({ name: entry.name, isDirectory: () => entry.isDirectory() })) : readdirSync(path),
  exists: async (path: string) => existsSync(path),
  unlink: async (path: string) => unlinkSync(path),
  rmdir: async (path: string) => rmdirSync(path),
  mkdir: async (path: string, options?: { recursive?: boolean }) => {
    mkdirSync(path, options);
  },
}));
