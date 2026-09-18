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

  OK=$(echo "$RES" | jq -r '.ok // false' 2>/dev/null)
  if [ "$OK" != "true" ]; then
    # Fallback to campaigns.events if narrator.read is temporarily unavailable
    EVENTS_RES=$(curl -s -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
      -d "{\"action\": \"campaigns.events\", \"params\": {\"campaignId\": \"$CAMPAIGN_ID\", \"afterSeq\": $LAST_SEQ, \"limit\": 50}}" \
      http://127.0.0.1:3005/api/internal/mcp)
    PLAYER_MSGS=$(echo "$EVENTS_RES" | jq -r '.result.events[]? | select(.type=="message_added" and .payload.message.authorType=="player" and (.payload.message.content | test("^\\s*\\(ooc\\)"; "i") | not)) | .payload.message | "[\(.seq)] \(.authorType): \(.content)"' 2>/dev/null)
    DIRECTOR=$(echo "$EVENTS_RES" | jq -r '.result.events[]? | select(.type=="director_armed") | "[\(.seq)] director_armed: \(.payload.armed)"' 2>/dev/null)
    if [ -n "$PLAYER_MSGS" ] || [ -n "$DIRECTOR" ]; then
      LATEST_SEQ=$(echo "$EVENTS_RES" | jq -r '.result.events[-1].seq')
      echo "LATEST_SEQ: $LATEST_SEQ"
      [ -n "$PLAYER_MSGS" ] && echo "$PLAYER_MSGS"
      [ -n "$DIRECTOR" ] && echo "$DIRECTOR"
      exit 0
    fi
    sleep 1
    continue
  fi

  # 1. Player In-Character messages (narrator.read automatically strips (ooc) messages)
  PLAYER_MSGS=$(echo "$RES" | jq -r '.result.messages[]? | select(.authorType=="player") | "[\(.seq)] \(.authorType): \(.content)"' 2>/dev/null)

  # 2. Director events
  DIRECTOR=$(echo "$RES" | jq -r '.result.events[]? | select(.type=="director_armed") | "[\(.seq)] director_armed: \(.payload.armed)"' 2>/dev/null)

  # 3. Pending Asks for the DM (private questions from players)
  PENDING_ASKS=$(echo "$RES" | jq -r '.result.asks[]? | select(.status=="pending") | "ASK [\(.id)] (\(.scope // "general")): \(.question)"' 2>/dev/null)

  # 4. Open pending rolls requested by the engine/DM
  PENDING_ROLLS=$(echo "$RES" | jq -r '.result.pendingRolls[]? | "PENDING_ROLL [\(.id)] char=\(.characterId) kind=\(.kind): \(.reason // "")"' 2>/dev/null)

  # 5. Global Turn Round Resolution events
  GLOBAL_TURN=$(echo "$RES" | jq -r '.result.events[]? | select(.type=="global_turn_ended" or .type=="global_turn_resolved") | "[\(.seq)] \(.type): round=\(.payload.roundNumber // .payload.resolvedRound)"' 2>/dev/null)

  if [ -n "$PLAYER_MSGS" ] || [ -n "$DIRECTOR" ] || [ -n "$PENDING_ASKS" ] || [ -n "$PENDING_ROLLS" ] || [ -n "$GLOBAL_TURN" ]; then
    LATEST_SEQ=$(echo "$RES" | jq -r '.result.currentSeq')
    echo "LATEST_SEQ: $LATEST_SEQ"
    [ -n "$PLAYER_MSGS" ] && echo "$PLAYER_MSGS"
    [ -n "$DIRECTOR" ] && echo "$DIRECTOR"
    [ -n "$PENDING_ASKS" ] && echo "$PENDING_ASKS"
    [ -n "$PENDING_ROLLS" ] && echo "$PENDING_ROLLS"
    [ -n "$GLOBAL_TURN" ] && echo "$GLOBAL_TURN"
    exit 0
  fi

  sleep 1
done
