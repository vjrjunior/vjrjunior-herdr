import { homedir } from "node:os";
import { join } from "node:path";

export function configHome(): string {
  return process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
}

export function herdrAppHome(): string {
  return process.env.HERDR_APP_HOME || join(configHome(), "herdr-app");
}

export function stateDir(): string {
  return join(process.env.XDG_STATE_HOME || join(homedir(), ".local/state"), "vjr-herdr");
}
