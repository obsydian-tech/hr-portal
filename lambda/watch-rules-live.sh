#!/bin/bash

# Live Rule Monitoring - Watch CloudWatch logs in real-time
# Usage: ./watch-rules-live.sh

set -e

REGION="${AWS_REGION:-af-south-1}"
LOG_GROUP="/aws/lambda/evaluateIntelligenceRules"

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
MAGENTA='\033[0;35m'
RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'

echo ""
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${RESET}"
echo -e "${BOLD}${CYAN}  🔴 LIVE: Intelligence Layer Rule Monitoring${RESET}"
echo -e "${CYAN}═══════════════════════════════════════════════════════════════════════════════${RESET}"
echo ""
echo -e "${DIM}Region: ${REGION}${RESET}"
echo -e "${DIM}Log Group: ${LOG_GROUP}${RESET}"
echo -e "${DIM}Press Ctrl+C to stop${RESET}"
echo ""
echo -e "${CYAN}───────────────────────────────────────────────────────────────────────────────${RESET}"
echo ""

# Function to format and colorize log messages
format_log() {
    while IFS= read -r line; do
        timestamp=$(echo "$line" | cut -d' ' -f1)
        message=$(echo "$line" | cut -d' ' -f2-)

        # Extract time part only (HH:MM:SS)
        time=$(echo "$timestamp" | cut -d'T' -f2 | cut -d'.' -f1)

        # Colorize based on content
        if echo "$message" | grep -q "Rule matched"; then
            rule_id=$(echo "$message" | grep -oP "ruleId: '\K[^']+")
            entity=$(echo "$message" | grep -oP "candidateId: '\K[^']+")
            echo -e "${DIM}[$time]${RESET} ${GREEN}✓ MATCHED${RESET} ${BOLD}${rule_id}${RESET} ${DIM}→ ${entity}${RESET}"

        elif echo "$message" | grep -q "Notification Lambda invoked"; then
            rule_id=$(echo "$message" | grep -oP "ruleId: '\K[^']+")
            action=$(echo "$message" | grep -oP "actionType: '\K[^']+")
            echo -e "${DIM}[$time]${RESET} ${CYAN}🔔 NOTIFY${RESET} ${MAGENTA}${action}${RESET} ${DIM}(${rule_id})${RESET}"

        elif echo "$message" | grep -q "Intelligence event logged"; then
            event_id=$(echo "$message" | grep -oP "eventId: '\K[^']+")
            echo -e "${DIM}[$time]${RESET} ${BLUE}📝 LOGGED${RESET} ${DIM}${event_id}${RESET}"

        elif echo "$message" | grep -q "Config loaded"; then
            count=$(echo "$message" | grep -oP "ruleCount: \K[0-9]+")
            echo -e "${DIM}[$time]${RESET} ${YELLOW}⚙️  LOADED${RESET} ${BOLD}${count} rules${RESET}"

        elif echo "$message" | grep -q "Batch complete"; then
            processed=$(echo "$message" | grep -oP "processed: \K[0-9]+")
            failed=$(echo "$message" | grep -oP "failed: \K[0-9]+")
            if [ "$failed" -gt 0 ]; then
                echo -e "${DIM}[$time]${RESET} ${RED}✗ BATCH${RESET} ${DIM}processed: ${processed}, failed: ${failed}${RESET}"
            else
                echo -e "${DIM}[$time]${RESET} ${GREEN}✓ BATCH${RESET} ${DIM}processed: ${processed}${RESET}"
            fi

        elif echo "$message" | grep -q "Rule skipped"; then
            # Don't show skips unless there's an interesting reason
            if echo "$message" | grep -q "signal_unavailable"; then
                : # Suppress - these are expected
            fi

        elif echo "$message" | grep -q "ERROR"; then
            echo -e "${DIM}[$time]${RESET} ${RED}${BOLD}❌ ERROR${RESET} ${RED}${message}${RESET}"

        fi
    done
}

# Start tailing logs
echo -e "${GREEN}Watching for rule activity...${RESET}"
echo ""

aws logs tail "$LOG_GROUP" \
    --region "$REGION" \
    --follow \
    --format short \
    --filter-pattern '"Rule matched" OR "Notification Lambda" OR "Intelligence event" OR "Config loaded" OR "Batch complete" OR "ERROR"' \
    2>/dev/null | format_log

# If the command exits
echo ""
echo -e "${YELLOW}Log streaming stopped${RESET}"
echo ""
