#!/usr/bin/env bash
set -euo pipefail

PORT="${STDB_TEST_PORT:-3917}"
SERVER="http://127.0.0.1:${PORT}"
DATABASE="rubble-test"
HERE="$(cd "$(dirname "$0")/.." && pwd)"
TEMP_DIR="$(mktemp -d)"
BODY="${TEMP_DIR}/body.json"
LOG="${TEMP_DIR}/server.log"
spacetime start --in-memory --data-dir "${TEMP_DIR}/data" --listen-addr "127.0.0.1:${PORT}" --non-interactive >"${LOG}" 2>&1 &
SERVER_PID=$!
cleanup() { kill "${SERVER_PID}" 2>/dev/null || true; wait "${SERVER_PID}" 2>/dev/null || true; rm -rf "${TEMP_DIR}"; }
trap cleanup EXIT

for _ in $(seq 1 60); do
  if curl -fsS "${SERVER}/v1/ping" >/dev/null 2>&1; then break; fi
  sleep 0.25
done
curl -fsS "${SERVER}/v1/ping" >/dev/null
spacetime publish "${DATABASE}" -p "${HERE}" --server "${SERVER}" --yes >/dev/null

new_identity() {
  local record
  record="$(curl -fsS -X POST "${SERVER}/v1/identity")"
  IDENTITY="$(printf '%s' "${record}" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).identity')"
  TOKEN="$(printf '%s' "${record}" | node -pe 'JSON.parse(require("fs").readFileSync(0, "utf8")).token')"
}
call_ok() {
  local token="$1" reducer="$2" body="$3" status
  status="$(curl -sS -o "${BODY}" -w '%{http_code}' -X POST "${SERVER}/v1/database/${DATABASE}/call/${reducer}" -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' -d "${body}")"
  if [[ "${status}" != 200 ]]; then cat "${BODY}"; printf 'FAIL %s returned HTTP %s\n' "${reducer}" "${status}"; exit 1; fi
  printf 'PASS %s\n' "${reducer}"
}
call_fail() {
  local token="$1" reducer="$2" body="$3" status
  status="$(curl -sS -o "${BODY}" -w '%{http_code}' -X POST "${SERVER}/v1/database/${DATABASE}/call/${reducer}" -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' -d "${body}")"
  if [[ "${status}" == 200 ]]; then printf 'FAIL %s unexpectedly succeeded\n' "${reducer}"; exit 1; fi
  printf 'PASS rejects invalid %s\n' "${reducer}"
}
sql_value() {
  curl -fsS -X POST "${SERVER}/v1/database/${DATABASE}/sql" -H "Authorization: Bearer ${1}" -H 'Content-Type: text/plain' -d "${2}"
}
sql_count() { sql_value "${1}" "${2}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows.length'; }
assert_sql_row() {
  local token="$1" query="$2" expected="$3" actual
  actual="$(sql_value "${token}" "${query}" | node -e 'const r=JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0]; console.log(JSON.stringify(r))')"
  if [[ "${actual}" != "${expected}" ]]; then printf 'FAIL SQL %s expected %s got %s\n' "${query}" "${expected}" "${actual}"; exit 1; fi
  printf 'PASS SQL invariant %s\n' "${query}"
}
wait_for_rows() {
  local token="$1" query="$2" minimum="$3" timeout_s="$4" count=0
  for _ in $(seq 1 "$((timeout_s * 2))"); do
    count="$(sql_count "${token}" "${query}")"
    if (( count >= minimum )); then return 0; fi
    sleep 0.5
  done
  printf 'FAIL timed out waiting for %s rows from %s (last count %s)\n' "${minimum}" "${query}" "${count}"
  return 1
}

new_identity; SIM_TOKEN="${TOKEN}"
call_ok "${SIM_TOKEN}" register_participant '["simulator",{"sim":[]}]'
call_ok "${SIM_TOKEN}" create_site '["Smoke site",32.99,-96.75,483,true,false]'
call_ok "${SIM_TOKEN}" set_site_timings '[1,5,5,5,5]'
call_ok "${SIM_TOKEN}" robot_heartbeat '["simdog",{"READY":[]},{"some":87},{"none":[]}]'
call_fail "${SIM_TOKEN}" robot_heartbeat '["simdog",{"safeStop":[]},{"some":87},{"none":[]}]'
call_ok "${SIM_TOKEN}" create_search_cell '[1,32.99,-96.75,20,"C1"]'
call_ok "${SIM_TOKEN}" mark_cell '[1,{"partially_searched":[]},{"none":[]}]'
call_ok "${SIM_TOKEN}" report_detection '["simdog",0,{"thermal":[]},"smoke1",32.99,-96.75,true,"near the entry",{"some":36.2},0.9,{"none":[]},{"none":[]},{"none":[]},{"none":[]}]'

SURVIVOR_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${SIM_TOKEN}" report_person "[1,{\"missing\":[]},2,{\"none\":[]},\"family reported two missing\",{\"family\":[]}]"
assert_sql_row "${SIM_TOKEN}" 'SELECT found, reported_missing, reported_safe, unaccounted FROM search_cell WHERE id = 1' '[1,2,0,1]'
call_ok "${SIM_TOKEN}" report_person "[1,{\"safe\":[]},1,{\"none\":[]},\"neighbor confirmed one safe\",{\"neighbor\":[]}]"
assert_sql_row "${SIM_TOKEN}" 'SELECT found, reported_missing, reported_safe, unaccounted FROM search_cell WHERE id = 1' '[1,2,1,0]'
new_identity; PERCEPTION_TOKEN="${TOKEN}"
call_ok "${PERCEPTION_TOKEN}" register_participant '["perception",{"perception":[]}]'
call_ok "${PERCEPTION_TOKEN}" set_critical_score "[${SURVIVOR_ID},{\"immediate\":[]},92,0.9,[\"breathing detected\"]]"
new_identity; RESCUER_TOKEN="${TOKEN}"; RESCUER_IDENTITY="${IDENTITY}"
call_ok "${RESCUER_TOKEN}" register_participant '["rescuer1",{"rescuer":[]}]'
call_ok "${RESCUER_TOKEN}" participant_update_position '[32.99,-96.75]'
call_ok "${SIM_TOKEN}" propose_assignment "[${SURVIVOR_ID},[\"0x${RESCUER_IDENTITY}\"],\"nearest rescuer\"]"
ASSIGNMENT_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM assignment' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${RESCUER_TOKEN}" accept_assignment "[${ASSIGNMENT_ID}]"
call_ok "${RESCUER_TOKEN}" start_en_route "[${ASSIGNMENT_ID}]"
call_ok "${RESCUER_TOKEN}" mark_reached "[${SURVIVOR_ID}]"
call_ok "${RESCUER_TOKEN}" resolve_survivor "[${SURVIVOR_ID},{\"rescued\":[]},\"rescued in smoke scenario\"]"

new_identity; RESCUER2_TOKEN="${TOKEN}"; RESCUER2_IDENTITY="${IDENTITY}"
call_ok "${RESCUER2_TOKEN}" register_participant '["rescuer2",{"rescuer":[]}]'
call_ok "${RESCUER2_TOKEN}" participant_update_position '[32.99018,-96.75]'
call_ok "${SIM_TOKEN}" report_detection '["simdog",0,{"thermal":[]} ,"smoke2",32.99018,-96.75,true,"north of the entry",{"some":35.8},0.88,{"none":[]},{"none":[]},{"none":[]},{"none":[]}]'
SURVIVOR2_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor WHERE lat > 32.9901' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${PERCEPTION_TOKEN}" set_critical_score "[${SURVIVOR2_ID},{\"immediate\":[]},90,0.8,[\"breathing visible\"]]"
call_ok "${SIM_TOKEN}" propose_assignment "[${SURVIVOR2_ID},[\"0x${RESCUER2_IDENTITY}\"],\"second rescuer\"]"
call_ok "${SIM_TOKEN}" post_briefing "[\"all\",\"Smoke briefing\",{\"info\":[]},{\"none\":[]},{\"none\":[]}]"
call_ok "${SIM_TOKEN}" post_briefing "[\"${RESCUER_IDENTITY}\",\"Private briefing\",{\"info\":[]},{\"none\":[]},{\"none\":[]}]"
[[ "$(sql_count "${RESCUER_TOKEN}" 'SELECT id FROM my_assignment')" == 1 ]]
[[ "$(sql_count "${RESCUER2_TOKEN}" 'SELECT id FROM my_assignment')" == 1 ]]
[[ "$(sql_count "${RESCUER_TOKEN}" 'SELECT id FROM my_briefing')" == 2 ]]
[[ "$(sql_count "${RESCUER2_TOKEN}" 'SELECT id FROM my_briefing')" == 1 ]]
printf 'PASS per-rescuer views isolate assignments and briefings\n'
EVENTS_BEFORE="$(sql_count "${SIM_TOKEN}" 'SELECT id FROM event_log')"
call_ok "${RESCUER_TOKEN}" participant_update_position '[32.99001,-96.75]'
EVENTS_AFTER="$(sql_count "${SIM_TOKEN}" 'SELECT id FROM event_log')"
[[ "${EVENTS_BEFORE}" == "${EVENTS_AFTER}" ]]
printf 'PASS append-only history stays unchanged for position updates\n'

# Keep the rescuer's authenticated WebSocket open while the assignment is accepted.
call_ok "${RESCUER_TOKEN}" register_participant '["rescuer1",{"rescuer":[]}]'
call_ok "${SIM_TOKEN}" report_detection '["simdog",0,{"thermal":[]} ,"smoke3",32.991,-96.75,true,"outside the first cell",{"some":35.1},0.82,{"none":[]},{"none":[]},{"none":[]},{"none":[]}]'
SURVIVOR3_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor WHERE lat > 32.9905' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${SIM_TOKEN}" propose_assignment "[${SURVIVOR3_ID},[\"0x${RESCUER_IDENTITY}\"],\"disconnect test\"]"
ASSIGNMENT3_ID="$(sql_value "${SIM_TOKEN}" "SELECT id FROM assignment WHERE survivor_id = ${SURVIVOR3_ID}" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
node "${HERE}/test/connect-session.cjs" "ws://127.0.0.1:${PORT}" "${DATABASE}" "${RESCUER_TOKEN}" >"${TEMP_DIR}/ws.log" 2>&1 &
WS_PID=$!
for _ in $(seq 1 50); do grep -q CONNECTED "${TEMP_DIR}/ws.log" && break; sleep 0.1; done
grep -q CONNECTED "${TEMP_DIR}/ws.log" || { cat "${TEMP_DIR}/ws.log"; exit 1; }
call_ok "${RESCUER_TOKEN}" accept_assignment "[${ASSIGNMENT3_ID}]"
kill -9 "${WS_PID}" 2>/dev/null || true
wait "${WS_PID}" 2>/dev/null || true
sleep 2.5
[[ "$(sql_count "${SIM_TOKEN}" "SELECT id FROM event_log WHERE kind = 'rescuer_offline'")" -ge 1 ]]
call_fail "${RESCUER_TOKEN}" start_en_route "[${ASSIGNMENT3_ID}]"
printf 'PASS disconnect grace releases the active assignment\n'

# The second immediate survivor remains unassigned with a pending proposal, so both
# escalation levels must fire on schedule even while the task lease test runs.
sleep 3
[[ "$(sql_count "${SIM_TOKEN}" "SELECT id FROM briefing WHERE audience = 'all'")" -ge 2 ]]
[[ "$(sql_count "${SIM_TOKEN}" "SELECT id FROM briefing WHERE audience = 'commander'")" -ge 1 ]]
printf 'PASS escalation level one and commander escalation fire\n'

new_identity; AUDITOR_TOKEN="${TOKEN}"
call_ok "${AUDITOR_TOKEN}" register_participant '["auditor",{"auditor":[]}]'
new_identity; COMMS_TOKEN="${TOKEN}"
call_ok "${COMMS_TOKEN}" register_participant '["comms_agent",{"agent":[]}]'
call_ok "${AUDITOR_TOKEN}" post_agent_task '[{"comms_agent":[]},"lease_smoke","{}",{"normal":[]},"lease expiry smoke",0]'
TASK_ID="$(sql_value "${AUDITOR_TOKEN}" "SELECT id FROM agent_task WHERE kind = 'lease_smoke'" | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${COMMS_TOKEN}" claim_agent_task "[${TASK_ID}]"
sleep 31
call_ok "${COMMS_TOKEN}" claim_agent_task "[${TASK_ID}]"
[[ "$(sql_count "${SIM_TOKEN}" "SELECT id FROM event_log WHERE kind = 'agent_task_expired'")" -ge 1 ]]
printf 'PASS claimed agent task returns to open after lease expiry\n'

# Several sweeps ran during the lease wait; each escalation level fires once per unattended period.
for kind in escalation escalation_commander; do
  fired="$(sql_count "${SIM_TOKEN}" "SELECT id FROM event_log WHERE kind = '${kind}' AND entity_id = ${SURVIVOR2_ID}")"
  if [[ "${fired}" != 1 ]]; then printf 'FAIL %s fired %s times for survivor %s, expected 1\n' "${kind}" "${fired}" "${SURVIVOR2_ID}"; exit 1; fi
done
printf 'PASS sweep does not re-fire escalation levels\n'

[[ "$(sql_count "${SIM_TOKEN}" "SELECT robot_id FROM robot WHERE robot_id = 'simdog' AND online = false")" == 1 ]]
[[ "$(sql_count "${SIM_TOKEN}" "SELECT id FROM event_log WHERE kind = 'robot_offline'")" -ge 1 ]]
printf 'PASS sweep marks a stale robot offline\n'

new_identity; RESCUER3_TOKEN="${TOKEN}"; RESCUER3_IDENTITY="${IDENTITY}"
call_ok "${SIM_TOKEN}" set_site_timings '[1,5,30,3600,5]'
call_ok "${RESCUER3_TOKEN}" register_participant '["rescuer3",{"rescuer":[]}]'
call_ok "${RESCUER3_TOKEN}" participant_update_position '[32.992,-96.75]'
new_identity; RESCUER4_TOKEN="${TOKEN}"; RESCUER4_IDENTITY="${IDENTITY}"
call_ok "${RESCUER4_TOKEN}" register_participant '["rescuer4",{"rescuer":[]}]'
call_ok "${RESCUER4_TOKEN}" participant_update_position '[32.993,-96.75]'

node "${HERE}/test/connect-session.cjs" "ws://127.0.0.1:${PORT}" "${DATABASE}" "${RESCUER3_TOKEN}" >"${TEMP_DIR}/ws3.log" 2>&1 & WS3_PID=$!
node "${HERE}/test/connect-session.cjs" "ws://127.0.0.1:${PORT}" "${DATABASE}" "${RESCUER4_TOKEN}" >"${TEMP_DIR}/ws4.log" 2>&1 & WS4_PID=$!
for _ in $(seq 1 50); do grep -q CONNECTED "${TEMP_DIR}/ws3.log" && grep -q CONNECTED "${TEMP_DIR}/ws4.log" && break; sleep 0.1; done
grep -q CONNECTED "${TEMP_DIR}/ws3.log" && grep -q CONNECTED "${TEMP_DIR}/ws4.log" || { cat "${TEMP_DIR}/ws3.log" "${TEMP_DIR}/ws4.log"; exit 1; }
heartbeat_loop() {
  local token="$1"
  while true; do
    local status
    status="$(curl -sS -o /dev/null -w '%{http_code}' -X POST "${SERVER}/v1/database/${DATABASE}/call/rescuer_heartbeat" -H "Authorization: Bearer ${token}" -H 'Content-Type: application/json' -d '[]')"
    printf '%s\n' "${status}" >>"${TEMP_DIR}/heartbeat.log"
    sleep 3
  done
}
heartbeat_loop "${RESCUER3_TOKEN}" & HB3_PID=$!
heartbeat_loop "${RESCUER4_TOKEN}" & HB4_PID=$!
call_ok "${SIM_TOKEN}" report_detection '["simdog",0,{"thermal":[]} ,"smoke4",32.992,-96.75,true,"north sector",{"some":35.3},0.95,{"none":[]},{"none":[]},{"none":[]},{"none":[]}]'
call_ok "${SIM_TOKEN}" report_detection '["simdog",0,{"thermal":[]} ,"smoke5",32.993,-96.75,true,"far north sector",{"some":35.0},0.95,{"none":[]},{"none":[]},{"none":[]},{"none":[]}]'
SURVIVOR4_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor WHERE lat > 32.9915 AND lat < 32.9925' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
SURVIVOR5_ID="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor WHERE lat > 32.9925' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
call_ok "${PERCEPTION_TOKEN}" set_critical_score "[${SURVIVOR4_ID},{\"immediate\":[]},95,0.9,[\"highest urgency\"]]"
call_ok "${PERCEPTION_TOKEN}" set_critical_score "[${SURVIVOR5_ID},{\"immediate\":[]},95,0.9,[\"highest urgency\"]]"
new_identity; ORCHESTRATOR_TOKEN="${TOKEN}"
call_ok "${ORCHESTRATOR_TOKEN}" register_participant '["orchestrator",{"agent":[]}]'
call_ok "${ORCHESTRATOR_TOKEN}" agent_heartbeat '[]'
if ! wait_for_rows "${RESCUER3_TOKEN}" "SELECT id FROM my_assignment WHERE survivor_id = ${SURVIVOR4_ID}" 1 35; then
  printf 'WATCHDOG_DIAGNOSTIC proposals=%s timers=%s\n' \
    "$(sql_count "${SIM_TOKEN}" 'SELECT id FROM assignment')" \
    "$(sql_count "${SIM_TOKEN}" 'SELECT scheduled_id FROM agent_watchdog')"
  sql_value "${SIM_TOKEN}" 'SELECT due_at, last_seen FROM agent_watchdog' || true
  cat "${TEMP_DIR}/heartbeat.log" || true
  sql_value "${SIM_TOKEN}" 'SELECT online, lat, lon, last_heartbeat FROM participant' || true
  sql_value "${SIM_TOKEN}" 'SELECT id, critical_score, status FROM survivor' || true
  tail -n 80 "${LOG}" || true
  exit 1
fi
wait_for_rows "${RESCUER4_TOKEN}" "SELECT id FROM my_assignment WHERE survivor_id = ${SURVIVOR5_ID}" 1 35
R3_ASSIGNMENT="$(sql_value "${RESCUER3_TOKEN}" 'SELECT id FROM my_assignment' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
R4_ASSIGNMENT="$(sql_value "${RESCUER4_TOKEN}" 'SELECT id FROM my_assignment' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')"
[[ "$(sql_value "${RESCUER3_TOKEN}" 'SELECT survivor_id FROM my_assignment' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')" == "${SURVIVOR4_ID}" ]]
[[ "$(sql_value "${RESCUER4_TOKEN}" 'SELECT survivor_id FROM my_assignment' | node -pe 'JSON.parse(require("fs").readFileSync(0,"utf8"))[0].rows[0][0]')" == "${SURVIVOR5_ID}" ]]
call_ok "${RESCUER3_TOKEN}" release_assignment "[${R3_ASSIGNMENT}]"
call_ok "${RESCUER4_TOKEN}" release_assignment "[${R4_ASSIGNMENT}]"
call_ok "${ORCHESTRATOR_TOKEN}" agent_heartbeat '[]'
wait_for_rows "${RESCUER3_TOKEN}" "SELECT id FROM my_assignment WHERE id > ${R3_ASSIGNMENT} AND survivor_id = ${SURVIVOR4_ID}" 1 35
wait_for_rows "${RESCUER4_TOKEN}" "SELECT id FROM my_assignment WHERE id > ${R4_ASSIGNMENT} AND survivor_id = ${SURVIVOR5_ID}" 1 35
[[ "$(sql_count "${RESCUER3_TOKEN}" "SELECT id FROM my_assignment WHERE id > ${R3_ASSIGNMENT} AND survivor_id = ${SURVIVOR4_ID}")" == 1 ]]
[[ "$(sql_count "${RESCUER4_TOKEN}" "SELECT id FROM my_assignment WHERE id > ${R4_ASSIGNMENT} AND survivor_id = ${SURVIVOR5_ID}")" == 1 ]]
printf 'PASS watchdog repeats deterministic nearest-rescuer proposals\n'
kill "${HB3_PID}" "${HB4_PID}" "${WS3_PID}" "${WS4_PID}" 2>/dev/null || true
wait "${HB3_PID}" "${HB4_PID}" "${WS3_PID}" "${WS4_PID}" 2>/dev/null || true

RESULT="$(sql_value "${SIM_TOKEN}" 'SELECT id FROM survivor')"
printf '%s' "${RESULT}" | node -e 'const x=JSON.parse(require("fs").readFileSync(0,"utf8")); if(x[0].rows.length<5) process.exit(1)'
printf 'PASS survivor records remain append-only through smoke flow\n'
