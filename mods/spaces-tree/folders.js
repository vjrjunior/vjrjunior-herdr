import { mostUrgent, PALETTE, rowsOf } from "./tree.js";

const NEEDS = new Set(["blocked", "done"]);

export function readFolders(value) {
  const folders = [];
  for (const folder of Array.isArray(value?.folders) ? value.folders : []) {
    if (typeof folder?.id !== "string" || !folder.id || typeof folder.name !== "string") continue;
    if (folders.some((known) => known.id === folder.id)) continue;
    folders.push({ id: folder.id, name: folder.name, color: PALETTE.includes(folder.color) ? folder.color : PALETTE[0], folded: folder.folded === true });
  }
  const ids = new Set(folders.map((folder) => folder.id));
  const given = value?.members && typeof value.members === "object" && !Array.isArray(value.members) ? value.members : {};
  const members = Object.fromEntries(Object.entries(given).filter(([, id]) => typeof id === "string" && ids.has(id)));
  return { folders, members };
}

export function arrange(entries, state) {
  const inside = new Map(state.folders.map((folder) => [folder.id, []]));
  const loose = [];
  for (const entry of entries) {
    const holder = inside.get(state.members[entry.key]);
    if (holder) holder.push(entry);
    else loose.push(entry);
  }
  return { folders: state.folders.map((folder) => ({ folder, entries: inside.get(folder.id) })), loose };
}

export function folderOf(state, unit) {
  const id = state.members[unit];
  return state.folders.some((folder) => folder.id === id) ? id : null;
}

export function fileUnit(state, unit, folderId) {
  const members = { ...state.members };
  if (folderId && state.folders.some((folder) => folder.id === folderId)) members[unit] = folderId;
  else delete members[unit];
  return { ...state, members };
}

export function newFolderId(time) {
  return `f${time.toString(36)}`;
}

export function nextColor(state) {
  const uses = (color) => state.folders.filter((folder) => folder.color === color).length;
  return PALETTE.reduce((best, color) => (uses(color) < uses(best) ? color : best));
}

export function createFolder(state, { id, name, color, unit }) {
  const folders = [...state.folders, { id, name: name.trim(), color: PALETTE.includes(color) ? color : nextColor(state), folded: false }];
  return { folders, members: unit ? { ...state.members, [unit]: id } : state.members };
}

function change(state, id, edit) {
  return { ...state, folders: state.folders.map((folder) => (folder.id === id ? { ...folder, ...edit } : folder)) };
}

export function renameFolder(state, id, name) {
  const trimmed = name.trim();
  return trimmed ? change(state, id, { name: trimmed }) : state;
}

export function recolorFolder(state, id, color) {
  return PALETTE.includes(color) ? change(state, id, { color }) : state;
}

export function toggleFolder(state, id) {
  const folder = state.folders.find((known) => known.id === id);
  return folder ? change(state, id, { folded: !folder.folded }) : state;
}

export function deleteFolder(state, id) {
  return {
    folders: state.folders.filter((folder) => folder.id !== id),
    members: Object.fromEntries(Object.entries(state.members).filter(([, owner]) => owner !== id)),
  };
}

export function revealFor(state, unit) {
  const id = folderOf(state, unit);
  const folder = state.folders.find((known) => known.id === id);
  return folder?.folded ? change(state, id, { folded: false }) : state;
}

export function entryOfSpace(entries, spaceId) {
  return entries.find((entry) => rowsOf(entry).some((row) => row.space?.id === spaceId)) ?? null;
}

export function folderTail(entries, agents) {
  const rows = entries.flatMap(rowsOf);
  const ids = new Set(rows.map((row) => row.space?.id).filter(Boolean));
  const needs = agents.filter((agent) => ids.has(agent.space) && NEEDS.has(agent.status)).length;
  return { needs, status: mostUrgent(rows.map((row) => row.status)) };
}
