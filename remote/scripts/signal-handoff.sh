#!/bin/sh
set -eu

project="${SIGNAL_COMPOSE_PROJECT:-openbot-remote}"
ready_seconds="${SIGNAL_HANDOFF_READY_SECONDS:-120}"
stop_seconds="${SIGNAL_HANDOFF_STOP_SECONDS:-120}"
root="$(cd "$(dirname "$0")/../.." && pwd)"

status_probe='const token=process.env.REMOTE_HANDOFF_TOKEN||process.env.REMOTE_METRICS_TOKEN||"";const answer=await fetch("http://127.0.0.1:"+process.env.REMOTE_HEALTH_PORT+"/handoff/status",{method:"POST",headers:{"OpenBot-Handoff-Token":token},signal:AbortSignal.timeout(3000)}).catch(()=>null);if(!answer||!answer.ok)process.exit(1);const body=await answer.json();console.log(JSON.stringify({state:body.state,linked:body.linked,sockets:body.sockets,drain:body.drain??null}))'

compose() {
  docker compose -p "$project" -f "$root/remote/compose.yaml" --profile slots "$@"
}

container() {
  docker ps -q --filter "label=com.docker.compose.project=$project" --filter "label=com.docker.compose.service=$1"
}

status() {
  id="$(container "$1")"
  [ -n "$id" ] || return 1
  docker exec "$id" bun -e "$status_probe" 2>/dev/null
}

fail() {
  printf '%s\n' "$1" >&2
  exit 1
}

if [ -n "$(container remote-api)" ]; then
  fail "The single remote-api service runs. Move this home to the slots first (signal-deploy skill, step 6)."
fi

blue="$(container remote-api-blue)"
green="$(container remote-api-green)"
if [ -n "$blue" ] && [ -n "$green" ]; then
  fail "Both slots run. A handoff is not complete. Wait, or stop one slot."
fi
if [ -z "$blue" ] && [ -z "$green" ]; then
  fail "No slot runs. Start one slot with: docker compose --profile slots up -d --no-build --no-deps remote-api-blue"
fi
if [ -n "$blue" ]; then
  old=remote-api-blue
  new=remote-api-green
else
  old=remote-api-green
  new=remote-api-blue
fi

before="$(status "$old")" || fail "The running slot $old does not answer the handoff status. Nothing changed."
case "$before" in
  *'"state":"ready"'*) ;;
  *) fail "The running slot $old is not ready. Nothing changed." ;;
esac
printf 'Before: %s %s\n' "$old" "$before"

compose up -d --no-build --no-deps "$new"

deadline=$(($(date +%s) + ready_seconds))
joined=""
while [ "$(date +%s)" -lt "$deadline" ]; do
  if [ -z "$(container "$new")" ]; then
    fail "The new slot $new stopped before it joined. $old keeps all sockets. Read: docker logs ${project}-${new}-1"
  fi
  joined="$(status "$new" || true)"
  case "$joined" in
    *'"state":"ready"'*'"linked":true'*) break ;;
  esac
  joined=""
  sleep 1
done
if [ -z "$joined" ]; then
  compose stop -t "$stop_seconds" "$new" || true
  fail "The new slot $new did not join $old in ${ready_seconds} s. It is stopped, and $old keeps all sockets."
fi
printf 'Joined: %s %s\n' "$new" "$joined"

compose stop -t "$stop_seconds" "$old" &
stopping=$!
drain=""
while [ -n "$(container "$old")" ]; do
  drain="$(status "$old" || printf '%s' "$drain")"
  sleep 1
done
wait "$stopping" || fail "docker compose stop $old failed. Check the two slots."

after="$(status "$new")" || fail "The new slot $new does not answer after the drain."
printf 'Drain: %s %s\n' "$old" "${drain:-unknown}"
printf 'After: %s %s\n' "$new" "$after"
case "$after" in
  *'"state":"ready"'*) ;;
  *) fail "The new slot $new is not ready after the drain." ;;
esac
printf 'Handoff complete. %s runs, %s is stopped.\n' "$new" "$old"
