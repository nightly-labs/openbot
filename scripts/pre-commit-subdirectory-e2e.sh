#!/bin/bash
# Checks that the pre-commit hook stages each file under its own path, in four layouts:
# OpenBot as the repository root or as a subdirectory of a larger repository, each in a normal
# checkout and in a linked worktree.
#
# Git runs a hook with GIT_DIR set and without GIT_WORK_TREE. In a linked worktree GIT_DIR points
# at the worktree's own git directory, so git takes the current directory as the top of the working
# tree. A hook that changes into a project subdirectory and runs `git add -- examples/x.json` then
# stages a second copy at `examples/x.json` instead of `<subdirectory>/examples/x.json`.
#
# The test copies the real hook into throwaway repositories, stubs `bun` so it needs no runtime,
# and commits one file in each layout. Each commit must contain exactly that file, and the hook must
# have seen it as staged. The report is written to .openbot-build/pre-commit-subdirectory.json.
#
# Usage: bash scripts/pre-commit-subdirectory-e2e.sh
set -euo pipefail

project_root=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
report="$project_root/.openbot-build/pre-commit-subdirectory.json"

fail() {
  echo "FAIL: $*" >&2
  exit 1
}

work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

# The stub stands in for every `bun` call of the hook. For `bun run check:staged` it records the
# staged paths that the hook sees, relative to the project, and changes nothing.
mkdir -p "$work/bin"
cat >"$work/bin/bun" <<'STUB'
#!/bin/sh
if [ "${1:-}" = "run" ] && [ "${2:-}" = "check:staged" ]; then
  git diff --cached --name-only --relative >>"$BUN_STAGED_LOG"
fi
exit 0
STUB
chmod +x "$work/bin/bun"
export PATH="$work/bin:$PATH"
export BUN_STAGED_LOG="$work/staged.log"

results=()

# Builds a repository whose OpenBot project is at `$2` ("" for the root) and commits one example
# file there, in a normal checkout and in a linked worktree.
check_layout() {
  local name=$1 subdirectory=$2
  local main="$work/$name/main" worktree="$work/$name/worktree"
  local project="$main${subdirectory:+/$subdirectory}"
  local expected="${subdirectory:+$subdirectory/}examples/x.json"

  mkdir -p "$project/.githooks" "$project/examples"
  cp "$project_root/.githooks/pre-commit" "$project/.githooks/pre-commit"
  chmod +x "$project/.githooks/pre-commit"
  echo '{}' >"$project/package.json"
  printf '{\n  "name": "example"\n}\n' >"$project/examples/x.json"

  git -C "$main" init -q -b main
  git -C "$main" config user.email "hook-test@example.com"
  git -C "$main" config user.name "Hook Test"
  git -C "$main" add -A
  git -C "$main" commit -qm "initial commit"
  git -C "$main" config core.hooksPath "${subdirectory:+$subdirectory/}.githooks"
  git -C "$main" worktree add -q -b feature "$worktree"

  local checkout kind committed
  for kind in checkout worktree; do
    if [ "$kind" = checkout ]; then checkout=$main; else checkout=$worktree; fi
    : >"$BUN_STAGED_LOG"
    printf '{\n  "name": "%s"\n}\n' "$kind" >"$checkout/$expected"
    git -C "$checkout" add -- "$expected"
    git -C "$checkout" commit -qm "change the example" || fail "$name $kind: the commit failed"
    committed=$(git -C "$checkout" show --pretty=format: --name-only HEAD | sed '/^$/d' | sort | tr '\n' ' ')
    [ "$committed" = "$expected " ] || fail "$name $kind: committed [$committed], expected [$expected]"
    grep -Fxq "examples/x.json" "$BUN_STAGED_LOG" || fail "$name $kind: the hook did not see the staged file"
    if [ -n "$subdirectory" ] && git -C "$checkout" ls-files --cached | grep -Fxq "examples/x.json"; then
      fail "$name $kind: the hook staged a second copy at the repository root"
    fi
    results+=("{\"layout\":\"$name\",\"checkout\":\"$kind\",\"committed\":\"$expected\",\"passed\":true}")
  done
  git -C "$main" worktree remove --force "$worktree"
}

check_layout root ""
check_layout subdirectory "vendor/openbot"

mkdir -p "$(dirname "$report")"
{
  printf '{"generatedAt":"%s","checks":[' "$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  (IFS=,; printf '%s' "${results[*]}")
  printf ']}\n'
} >"$report"
echo "PASS: the pre-commit hook staged each file under its own path in ${#results[@]} layouts. Report: $report"
