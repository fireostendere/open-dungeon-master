#!/usr/bin/env bash
# watch-player.sh: Autonomous live event & ask listener for external Dungeon Master
LAST_SEQ="${1:-0}"
CAMPAIGN_ID="${2:-343ed859-02a4-41f0-85cc-a1b228c503c4}"
TOKEN_FILE="${WATCH_TOKEN_FILE:-/opt/odm/config/mcp.token}"
CONTROL_URL="${WATCH_CONTROL_URL:-http://127.0.0.1:3005/api/internal/mcp}"
TIMEOUT="${WATCH_TIMEOUT:-1800}"
INTERVAL="${WATCH_INTERVAL:-1}"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "ERROR: Token file $TOKEN_FILE not found." >&2
  exit 1
fi
TOKEN=$(cat "$TOKEN_FILE")

START_TIME=$(date +%s)

while true; do
  NOW=$(date +%s)
  if [ $((NOW - START_TIME)) -ge $TIMEOUT ]; then
    echo "TIMEOUT_NO_MESSAGES"
    exit 0
  fi

  # Call narrator.read with projection:live and maxBytes:131072 to avoid pagination errors
  RES=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"action\": \"narrator.read\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"projection\": \"live\", \"maxBytes\": 131072, \"afterSeq\": $LAST_SEQ}}" \
    "$CONTROL_URL")

  # Single-pass jq filter for all game triggers
  PARSED=$(echo "$RES" | jq -r '
    if .ok != true then
      "NOT_OK"
    else
      [ .result.messages[]? | select(.authorType=="player" and (.kind != "ooc") and ((.content // "") | test("^\\s*\\(ooc\\)"; "i") | not)) | "[\(.seq)] \(.authorType): \(.content)" ] as $player_msgs |
      [ .result.events[]? | select(.type=="pending_roll" or .type=="roll_requested" or .type=="pending_roll_updated" or .type=="autopilot_action_requested") | "[\(.seq)] \(.type)" ] as $pending_events |
      [ .result.asks[]? | select(.status=="pending") | "ASK [\(.id)] (\(.scope // "general")): \(.question)" ] as $asks |
      [ .result.pendingRolls[]? | "PENDING_ROLL [\(.id)] char=\(.characterId) kind=\(.kind): \(.reason // "")" ] as $rolls |
      (if (.result.campaign.gameSettings.globalTurn.enabled // false) and (.result.encounter == null) and ((.result.campaign.globalTurnState.phase // "") == "active" or (.result.campaign.globalTurnState.phase // "") == "quorum_delay") then
        [ (.result.members[]? | select(.autopilot == true and (.muted // false | not) and ((.skipTurnsCount // 0) <= 0))) as $m |
          (.result.sheets[]? | select(.userId == $m.userId and (.isCompanion // false | not))) as $s |
          select((.result.campaign.globalTurnState.actionsByCharacter[$s.id] // null) == null) |
          "AUTOPILOT_ACTION_NEEDED [\($s.id)] round=\(.result.campaign.globalTurnState.roundNumber // 0)"
        ]
      else [] end) as $autopilot_needs |
      if ($player_msgs | length > 0) or ($pending_events | length > 0) or ($asks | length > 0) or ($rolls | length > 0) or ($autopilot_needs | length > 0) then
        "TRIGGERED\nLATEST_SEQ: \(.result.currentSeq // 0)\n" +
        (($player_msgs + $pending_events + $asks + $rolls + $autopilot_needs) | join("\n"))
      else
        "IDLE"
      end
    end
  ' 2>/dev/null)

  if [ "$PARSED" = "NOT_OK" ] || [ -z "$PARSED" ]; then
    # Fallback to campaigns.events if narrator.read is temporarily unavailable
    EVENTS_RES=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"action\": \"campaigns.events\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"afterSeq\": $LAST_SEQ, \"limit\": 50}}" \
      "$CONTROL_URL")

    FALLBACK_PARSED=$(echo "$EVENTS_RES" | jq -r '
      [ .result.events[]? | select(.type=="message_added" and .payload.message.authorType=="player" and (.payload.message.kind != "ooc") and (.payload.message.content | test("^\\s*\\(ooc\\)"; "i") | not)) | .payload.message | "[\(.seq)] \(.authorType): \(.content)" ] as $player_msgs |
      [ .result.events[]? | select(.type=="pending_roll" or .type=="roll_requested" or .type=="pending_roll_updated" or .type=="autopilot_action_requested") | "[\(.seq)] \(.type)" ] as $pending_events |
      if ($player_msgs | length > 0) or ($pending_events | length > 0) then
        "TRIGGERED\nLATEST_SEQ: \(.result.events[-1].seq // 0)\n" +
        (($player_msgs + $pending_events) | join("\n"))
      else
        "IDLE"
      end
    ' 2>/dev/null)

    if [[ "$FALLBACK_PARSED" == TRIGGERED* ]]; then
      echo "${FALLBACK_PARSED#TRIGGERED$'\n'}"
      exit 0
    fi
    sleep "$INTERVAL"
    continue
  fi

  if [[ "$PARSED" == TRIGGERED* ]]; then
    echo "${PARSED#TRIGGERED$'\n'}"
    exit 0
  fi

  sleep "$INTERVAL"
done
