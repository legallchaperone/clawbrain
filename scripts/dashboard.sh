#!/usr/bin/env bash
#
# dashboard.sh — CLI stats on memory health
#
# Usage: ./scripts/dashboard.sh [workspace_dir]

set -euo pipefail

WORKSPACE_DIR="${1:-.}"
ENGINE_DIR="$WORKSPACE_DIR/memory-engine"
DB_FILE="$ENGINE_DIR/engine.db"

echo "========================================="
echo "  clawbrain Dashboard"
echo "========================================="
echo ""

if [ ! -d "$ENGINE_DIR" ]; then
    echo "Error: No memory-engine directory found at $ENGINE_DIR"
    exit 1
fi

# Count entities
PEOPLE_COUNT=0
PROJECTS_COUNT=0
PREFS_COUNT=0
EPISODES_COUNT=0
ARCHIVED_COUNT=0

if [ -d "$ENGINE_DIR/entities/people" ]; then
    PEOPLE_COUNT=$(find "$ENGINE_DIR/entities/people" -name "*.md" | wc -l)
fi
if [ -d "$ENGINE_DIR/entities/projects" ]; then
    PROJECTS_COUNT=$(find "$ENGINE_DIR/entities/projects" -name "*.md" | wc -l)
fi
if [ -d "$ENGINE_DIR/entities/preferences" ]; then
    PREFS_COUNT=$(find "$ENGINE_DIR/entities/preferences" -name "*.md" | wc -l)
fi
if [ -d "$ENGINE_DIR/episodes" ]; then
    EPISODES_COUNT=$(find "$ENGINE_DIR/episodes" -name "*.md" | wc -l)
fi
if [ -d "$ENGINE_DIR/archive" ]; then
    ARCHIVED_COUNT=$(find "$ENGINE_DIR/archive" -name "*.md" | wc -l)
fi

TOTAL=$((PEOPLE_COUNT + PROJECTS_COUNT + PREFS_COUNT + EPISODES_COUNT))

echo "Memory Store"
echo "-----------------------------------------"
printf "  People:       %4d\n" "$PEOPLE_COUNT"
printf "  Projects:     %4d\n" "$PROJECTS_COUNT"
printf "  Preferences:  %4d\n" "$PREFS_COUNT"
printf "  Episodes:     %4d\n" "$EPISODES_COUNT"
printf "  ─────────────────\n"
printf "  Total Active: %4d\n" "$TOTAL"
printf "  Archived:     %4d\n" "$ARCHIVED_COUNT"
echo ""

# SQLite stats (if available)
if [ -f "$DB_FILE" ] && command -v sqlite3 &> /dev/null; then
    echo "Credit Scores"
    echo "-----------------------------------------"

    AVG=$(sqlite3 "$DB_FILE" "SELECT ROUND(AVG(credit_score), 3) FROM credit_records;" 2>/dev/null || echo "N/A")
    HIGH=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM credit_records WHERE credit_score >= 0.7;" 2>/dev/null || echo "N/A")
    LOW=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM credit_records WHERE credit_score < 0.3;" 2>/dev/null || echo "N/A")
    TOTAL_CR=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM credit_records;" 2>/dev/null || echo "N/A")

    printf "  Tracked:      %4s\n" "$TOTAL_CR"
    printf "  Average:      %s\n" "$AVG"
    printf "  High (>=0.7): %4s\n" "$HIGH"
    printf "  Low (<0.3):   %4s\n" "$LOW"
    echo ""

    echo "Recent Activity"
    echo "-----------------------------------------"
    TURN_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM turn_records;" 2>/dev/null || echo "N/A")
    EVENT_COUNT=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM credit_events;" 2>/dev/null || echo "N/A")
    UNRESOLVED=$(sqlite3 "$DB_FILE" "SELECT COUNT(*) FROM contradictions WHERE resolved = 0;" 2>/dev/null || echo "N/A")

    printf "  Turn records:          %4s\n" "$TURN_COUNT"
    printf "  Credit events:         %4s\n" "$EVENT_COUNT"
    printf "  Unresolved conflicts:  %4s\n" "$UNRESOLVED"
    echo ""

    echo "Top 5 Highest Credit Memories"
    echo "-----------------------------------------"
    sqlite3 -column "$DB_FILE" \
        "SELECT memory_id, ROUND(credit_score, 3) as credit, recall_count as recalls
         FROM credit_records
         ORDER BY credit_score DESC
         LIMIT 5;" 2>/dev/null || echo "  (no data)"
    echo ""

    echo "Lifecycle Log (last 5)"
    echo "-----------------------------------------"
    sqlite3 -column "$DB_FILE" \
        "SELECT action, timestamp
         FROM lifecycle_log
         ORDER BY timestamp DESC
         LIMIT 5;" 2>/dev/null || echo "  (no data)"
else
    if [ ! -f "$DB_FILE" ]; then
        echo "(No database found — engine hasn't been initialized yet)"
    else
        echo "(sqlite3 not available — install it for detailed stats)"
    fi
fi

echo ""
echo "========================================="
