export function snapshot(spaces, layout, values) {
  const names = {};
  const tabs = {};
  const order = {};
  for (const space of spaces) {
    names[space.id] = space.name;
    order[space.id] = space.tabs.map((tab) => tab.id);
    for (const tab of space.tabs) tabs[tab.id] = { name: tab.name, space: space.id, panes: tab.panes ?? null };
  }
  return { layout: layout ?? null, names, tabs, order, values };
}

export function same(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function short(value) {
  const text = JSON.stringify(value);
  return text.length > 120 ? `${text.slice(0, 117)}...` : text;
}

export function changes(before, after) {
  const lines = [];
  const where = (id) => after.names[id] ?? before.names[id] ?? id;
  if (before.layout !== after.layout) lines.push(`layout ${after.layout}`);
  for (const id of Object.keys(after.names)) if (!(id in before.names)) lines.push(`space "${after.names[id]}" opened`);
  for (const id of Object.keys(before.names)) if (!(id in after.names)) lines.push(`space "${before.names[id]}" closed`);
  for (const [id, tab] of Object.entries(after.tabs)) {
    const old = before.tabs[id];
    if (!old) lines.push(`tab "${tab.name}" opened in "${where(tab.space)}"`);
    else if (old.space !== tab.space) lines.push(`tab "${tab.name}" moved from "${where(old.space)}" to "${where(tab.space)}"`);
    else if (old.panes !== tab.panes && tab.panes !== null) lines.push(`tab "${tab.name}" in "${where(tab.space)}" has ${tab.panes} panes`);
  }
  for (const [id, tab] of Object.entries(before.tabs)) if (!(id in after.tabs)) lines.push(`tab "${tab.name}" closed in "${where(tab.space)}"`);
  for (const [id, ids] of Object.entries(after.order)) {
    const old = before.order[id];
    if (!old || old.length !== ids.length || ids.some((tab) => !old.includes(tab)) || same(old, ids)) continue;
    lines.push(`tabs in "${where(id)}" reordered: ${ids.map((tab) => `"${after.tabs[tab].name}"`).join(", ")}`);
  }
  for (const [key, value] of Object.entries(after.values)) {
    const old = before.values[key] ?? null;
    if (same(old, value)) continue;
    lines.push(value == null ? `${key} cleared` : `${key} = ${short(value)}`);
  }
  return lines;
}

export function summary(title, steps, results) {
  const parts = steps.map((step, index) => {
    const result = results.find((item) => item.step === index);
    if (!result) return `${index + 1} skipped`;
    const mark = result.verdict === "passed" ? "passed" : "FAILED";
    return result.note ? `${index + 1} ${mark} (${result.note})` : `${index + 1} ${mark}`;
  });
  const passed = results.filter((item) => item.verdict === "passed").length;
  return `Test panel "${title}": ${passed} of ${steps.length} passed. ${parts.join("; ")}. Details: bun run test-panel --results`;
}
