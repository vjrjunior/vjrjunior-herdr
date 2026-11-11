#!/bin/sh
set -u

me=$0
label=vjr.move-to

usage() {
  echo "Usage: sh $me --to <worktree> [--prompt <text>] | sh $me --cancel" >&2
  exit 2
}

fail() {
  printf '%s\n' "$*"
  exit 1
}

to="" prompt="" cancel=0
while [ $# -gt 0 ]; do
  case $1 in
    --to) [ $# -ge 2 ] || usage; to=$2; shift 2 ;;
    --prompt) [ $# -ge 2 ] || usage; prompt=$2; shift 2 ;;
    --cancel) cancel=1; shift ;;
    *) usage ;;
  esac
done
[ "$cancel" = 1 ] || [ -n "$to" ] || usage

terminal=${HC_TERMINAL_ID:-}
[ -n "$terminal" ] || fail "Not in a herdr-app terminal, so nothing would move this session."
for program in hc jq herdr-app git; do
  command -v "$program" >/dev/null 2>&1 || fail "$program is not on PATH."
done

if [ "$cancel" = 1 ]; then
  hc label "$terminal" "$label=" >/dev/null 2>&1 || fail "Couldn't clear the scheduled move."
  echo "No move is scheduled for this session now."
  exit 0
fi

case $prompt in -*) fail "The prompt can't start with -." ;; esac

layout=$(herdr-app status 2>/dev/null | jq -r '.layout // empty' 2>/dev/null)
case $layout in
  vjr-desk|vjr-desk-square) ;;
  *) fail "herdr-app shows ${layout:-no layout}, not vjr-desk or vjr-desk-square, so nothing would move this session." ;;
esac

info=$(hc get "$terminal" --json 2>/dev/null) || fail "Couldn't read terminal $terminal."
field() { printf '%s' "$info" | jq -r "$1 // empty"; }
program=$(field '.foreground.argv[0]')
[ "${program##*/}" = claude ] || fail "Claude Code is not in front in this terminal."
[ -z "$(field '.parent')" ] || fail "This terminal is another agent's sub-agent, so it has no tab to move."
[ -n "$(field '.status.state')" ] || fail "Claude reports no status in this terminal, so nothing can tell when its turn ends."

pid=$(field '.foreground.pid')
session=$(jq -r '.sessionId // empty' "$HOME/.claude/sessions/$pid.json" 2>/dev/null)
[ -n "$session" ] || session=${CLAUDE_CODE_SESSION_ID:-}
[ -n "$session" ] || fail "Couldn't find this Claude's conversation."
cwd=$(field '.foreground.cwd')
[ -n "$cwd" ] || cwd=$(field '.cwd')
[ -n "$cwd" ] && [ -d "$cwd" ] || fail "Couldn't tell which folder this Claude runs in."

wanted=$(cd "$to" 2>/dev/null && pwd -P) || fail "$to doesn't exist."
here=$(git -C "$cwd" rev-parse --show-toplevel 2>/dev/null) || fail "This session is not in a git repo."
here=$(cd "$here" && pwd -P)
[ "$here" != "$wanted" ] || fail "The session is already in $wanted."
target=$(git -C "$cwd" worktree list --porcelain 2>/dev/null | sed -n 's/^worktree //p' | while IFS= read -r path; do
  if [ "$(cd "$path" 2>/dev/null && pwd -P)" = "$wanted" ]; then
    printf '%s\n' "$path"
    break
  fi
done)
[ -n "$target" ] || fail "$to is not a worktree of this repo."

value=$(jq -nc --arg to "$target" --arg session "$session" --arg prompt "$prompt" \
  '{v: 1, to: $to, session: $session, at: (now * 1000 | floor)} + (if $prompt == "" then {} else {prompt: $prompt} end)') \
  || fail "Couldn't write the scheduled move."
hc label "$terminal" "$label=$value" >/dev/null 2>&1 || fail "Couldn't schedule the move."
branch=$(git -C "$target" branch --show-current 2>/dev/null)
echo "This session moves to ${branch:-$target} when the current turn ends. Cancel with: sh $me --cancel"
