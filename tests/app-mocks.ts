import { mock } from "bun:test";

type Handler = (...args: unknown[]) => void;

export class Node {
  key?: string;
  handlers: Record<string, Handler[]> = {};
  kids: Node[] = [];
  texts: string[] = [];
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
      return prop in target ? Reflect.get(target, prop, receiver) : () => receiver;
    },
  });
}

export const herdr: Record<string, (...args: never[]) => unknown> = {};

const HERDR = ["exec", "notify", "props", "updates", "spaces", "panes", "run", "openOverlay", "theme", "shared", "setShared", "watchFolder", "window", "nextCommand", "layout", "agents", "readTextFile", "home"];

mock.module("gpui-kit", () => ({ View: class {}, div: make, svg: () => make() }));
mock.module("gpui-base", () => ({ v_flex: make, h_flex: make }));
mock.module("herdr", () => Object.fromEntries(HERDR.map((name) => [name, (...args: never[]) => herdr[name]?.(...args)])));
