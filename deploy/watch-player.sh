#!/usr/bin/env bash
# watch-player.sh: Autonomous live event & ask listener for external Dungeon Master
LAST_SEQ="${1:-0}"
CAMPAIGN_ID="${2:-343ed859-02a4-41f0-85cc-a1b228c503c4}"
TOKEN_FILE="/opt/odm/config/mcp.token"

if [ ! -f "$TOKEN_FILE" ]; then
  echo "ERROR: Token file $TOKEN_FILE not found." >&2
  exit 1
fi
TOKEN=$(cat "$TOKEN_FILE")

START_TIME=$(date +%s)
TIMEOUT=1800 # 30 minutes timeout

while true; do
  NOW=$(date +%s)
  if [ $((NOW - START_TIME)) -ge $TIMEOUT ]; then
    echo "TIMEOUT_NO_MESSAGES"
    exit 0
  fi

  # Call narrator.read with projection:live and maxBytes:131072 to avoid pagination errors
  RES=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
    -d "{\"action\": \"narrator.read\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"projection\": \"live\", \"maxBytes\": 131072, \"afterSeq\": $LAST_SEQ}}" \
    http://127.0.0.1:3005/api/internal/mcp)

  # Single-pass jq filter for all game triggers
  PARSED=$(echo "$RES" | jq -r '
    if .ok != true then
      "NOT_OK"
    else
      [ .result.messages[]? | select(.authorType=="player") | "[\(.seq)] \(.authorType): \(.content)" ] as $player_msgs |
      [ .result.events[]? | select(.type=="director_armed") | "[\(.seq)] director_armed: \(.payload.armed)" ] as $director |
      [ .result.asks[]? | select(.status=="pending") | "ASK [\(.id)] (\(.scope // "general")): \(.question)" ] as $asks |
      [ .result.pendingRolls[]? | "PENDING_ROLL [\(.id)] char=\(.characterId) kind=\(.kind): \(.reason // "")" ] as $rolls |
      [ .result.events[]? | select(.type=="global_turn_ended" or .type=="global_turn_resolved") | "[\(.seq)] \(.type): round=\(.payload.roundNumber // .payload.resolvedRound)" ] as $turns |
      if ($player_msgs | length > 0) or ($director | length > 0) or ($asks | length > 0) or ($rolls | length > 0) or ($turns | length > 0) then
        "TRIGGERED\nLATEST_SEQ: \(.result.currentSeq // 0)\n" +
        (($player_msgs + $director + $asks + $rolls + $turns) | join("\n"))
      else
        "IDLE"
      end
    end
  ' 2>/dev/null)

  if [ "$PARSED" = "NOT_OK" ] || [ -z "$PARSED" ]; then
    # Fallback to campaigns.events if narrator.read is temporarily unavailable
    EVENTS_RES=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"action\": \"campaigns.events\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"afterSeq\": $LAST_SEQ, \"limit\": 50}}" \
      http://127.0.0.1:3005/api/internal/mcp)

    FALLBACK_PARSED=$(echo "$EVENTS_RES" | jq -r '
      [ .result.events[]? | select(.type=="message_added" and .payload.message.authorType=="player" and (.payload.message.content | test("^\\s*\\(ooc\\)"; "i") | not)) | .payload.message | "[\(.seq)] \(.authorType): \(.content)" ] as $player_msgs |
      [ .result.events[]? | select(.type=="director_armed") | "[\(.seq)] director_armed: \(.payload.armed)" ] as $director |
      if ($player_msgs | length > 0) or ($director | length > 0) then
        "TRIGGERED\nLATEST_SEQ: \(.result.events[-1].seq // 0)\n" +
        (($player_msgs + $director) | join("\n"))
      else
        "IDLE"
      end
    ' 2>/dev/null)

    if [[ "$FALLBACK_PARSED" == TRIGGERED* ]]; then
      echo "${FALLBACK_PARSED#TRIGGERED$'\n'}"
      exit 0
    fi
    sleep "${WATCH_INTERVAL:-2}"
    continue
  fi

  if [[ "$PARSED" == TRIGGERED* ]]; then
    echo "${PARSED#TRIGGERED$'\n'}"
    exit 0
  fi

  sleep "${WATCH_INTERVAL:-2}"
done
