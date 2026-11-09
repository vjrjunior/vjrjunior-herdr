import { div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { props, theme, shared, setShared, closeOverlay, openOverlay } from "herdr";
import { createFolder, deleteFolder, fileUnit, folderOf, newFolderId, nextColor, readFolders, recolorFolder, renameFolder } from "./folders.js";
import { PALETTE, paint } from "./tree.js";
import { CONTROL, RADIUS, TEXT, button, popupRow } from "../../kit/kit.js";

export const FOLDERS = "spaces.folders";
export const FOLDER_MENU = { width: 220, height: 122 };
export const NAME_DIALOG = { width: 340, height: 180 };
const PAD = 4;
const TITLE = 24;
const SEPARATOR = 9;

export function movePopupHeight(count, inFolder) {
  return PAD * 2 + TITLE + (count + 1 + (inFolder ? 1 : 0)) * (CONTROL.row + 1) + (inFolder ? SEPARATOR : 0);
}

export const readState = () => readFolders(shared(FOLDERS));

export function saveState(before, after) {
  if (after !== before) setShared(FOLDERS, after);
}

export function openNameDialog(extra) {
  openOverlay({ mod: "spaces-tree", kind: "dialog", width: NAME_DIALOG.width, height: NAME_DIALOG.height, props: { role: "name", ...extra } });
}

export function startPopup(view, cx) {
  const p = props() ?? {};
  view.overlay = p.overlay ?? null;
  view.handle = cx?.focus_handle?.() ?? null;
  if (view.role !== "name") return;
  const state = readState();
  const folder = state.folders.find((known) => known.id === p.folder) ?? null;
  view.color = folder?.color ?? nextColor(state);
  view.input = InputState.new({ value: folder?.name ?? "", placeholder: "Folder name" });
  if (folder) view.input.set_selected_range({ start: 0, end: folder.name.length });
  view.input.on("change", (_e, cx) => cx.notify());
  view.input.on("submit", () => saveName(view));
  view.input.focus();
  cx?.timer?.after?.(600, () => view.input.focus());
}

function closePopup(view) {
  closeOverlay(view.overlay ?? props()?.overlay);
}

function saveName(view) {
  const name = view.input.value().trim();
  if (!name) return;
  const state = readState();
  const p = props() ?? {};
  const folder = state.folders.find((known) => known.id === p.folder);
  const next = folder ? recolorFolder(renameFolder(state, folder.id, name), folder.id, view.color) : createFolder(state, { id: newFolderId(Date.now()), name, color: view.color, unit: p.unit });
  saveState(state, next);
  closePopup(view);
}

function separator(t) {
  return div().flex_none().mx(4).my(4).h(1).bg(t.border);
}

function swatch(id, color, current, onClick, t) {
  return h_flex()
    .id(id)
    .size(22)
    .flex_none()
    .items_center()
    .justify_center()
    .rounded(11)
    .when(current, (el) => el.border(1.5).border_color(t.foreground))
    .hover((s) => s.bg(t.hover))
    .on_click((_e, cx) => onClick(cx))
    .child(div().size(14).rounded(7).bg(paint(color, t)));
}

function moveView(view, t) {
  const { unit, name } = props() ?? {};
  const state = readState();
  const current = folderOf(state, unit);
  const file = (id) => {
    saveState(state, fileUnit(state, unit, id));
    closePopup(view);
  };
  return v_flex()
    .id("folders-popup")
    .size_full()
    .p(PAD)
    .gap(1)
    .bg(t.popover)
    .child(div().h(TITLE).flex_none().px(8).pt(6).text_size(TEXT.xs).text_color(t.unknown).truncate().child(`MOVE TO FOLDER · ${String(name ?? "").toUpperCase()}`))
    .children(state.folders.map((folder) => popupRow(`move-${folder.id}`, { dot: paint(folder.color, t), label: folder.name, check: folder.id === current, onClick: () => file(folder.id) }, t)))
    .child(
      popupRow(
        "move-new",
        {
          icon: "plus",
          label: "New folder…",
          onClick: () => {
            closePopup(view);
            openNameDialog({ unit });
          },
        },
        t,
      ),
    )
    .when(Boolean(current), (el) => el.child(separator(t)).child(popupRow("move-out", { icon: "x", label: "Remove from folder", onClick: () => file(null) }, t)));
}

function folderView(view, t) {
  const id = props()?.folder;
  const state = readState();
  const folder = state.folders.find((known) => known.id === id);
  if (!folder) return v_flex().id("folder-popup").size_full();
  return v_flex()
    .id("folder-popup")
    .size_full()
    .p(PAD)
    .gap(1)
    .bg(t.popover)
    .child(
      h_flex()
        .h(CONTROL.large)
        .flex_none()
        .px(4)
        .gap(6)
        .items_center()
        .children(PALETTE.map((color) => swatch(`folder-color-${color}`, color, folder.color === color, () => saveState(state, recolorFolder(state, folder.id, color)), t))),
    )
    .child(separator(t))
    .child(
      popupRow(
        "folder-rename",
        {
          icon: "folder",
          label: "Rename…",
          onClick: () => {
            closePopup(view);
            openNameDialog({ folder: folder.id });
          },
        },
        t,
      ),
    )
    .child(separator(t))
    .child(
      popupRow(
        "folder-delete",
        {
          icon: "x",
          label: "Delete folder",
          color: t.blocked,
          onClick: () => {
            saveState(state, deleteFolder(state, folder.id));
            closePopup(view);
          },
        },
        t,
      ),
    );
}

function nameView(view, t) {
  const renaming = readState().folders.some((known) => known.id === props()?.folder);
  const empty = !view.input.value().trim();
  return v_flex()
    .id("name-dialog")
    .when(Boolean(view.handle), (el) => el.track_focus(view.handle))
    .on_key_down((event, cx) => {
      if (event.key !== "escape") return;
      cx.stop_propagation();
      closePopup(view);
    })
    .size_full()
    .p(16)
    .gap(12)
    .bg(t.popover)
    .text_color(t.foreground)
    .child(
      h_flex()
        .items_center()
        .child(div().flex_1().text_size(TEXT.title).font_semibold().child(renaming ? "Rename folder" : "New folder"))
        .child(div().text_size(TEXT.sm).text_color(t.dim).child("Esc")),
    )
    .child(Input.new(view.input).h(CONTROL.large).px(10).rounded(RADIUS.control).border_1().border_color(t.accent).bg(t.background).text_size(TEXT.base).text_color(t.foreground))
    .child(
      h_flex()
        .gap(6)
        .children(
          PALETTE.map((color) =>
            swatch(
              `name-color-${color}`,
              color,
              view.color === color,
              (cx) => {
                view.color = color;
                cx?.notify?.();
              },
              t,
            ),
          ),
        ),
    )
    .child(
      h_flex()
        .gap(8)
        .justify_end()
        .child(button("name-cancel", { label: "Cancel", onClick: () => closePopup(view) }, t))
        .child(button("name-save", { label: renaming ? "Save" : "Create", variant: "solid", disabled: empty, onClick: () => saveName(view) }, t)),
    );
}

export function renderPopup(view) {
  const t = theme();
  if (view.role === "name") return nameView(view, t);
  if (view.role === "folder") return folderView(view, t);
  return moveView(view, t);
}
