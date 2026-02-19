#!/usr/bin/env bash
#
# migrate.sh — Migrate from flat MEMORY.md to structured memory store
#
# Usage: ./scripts/migrate.sh [workspace_dir]
#
# What this script does:
# 1. Backs up existing MEMORY.md
# 2. Creates the memory-engine directory structure
# 3. Scans daily logs for significant episodes
# 4. Prints instructions for the LLM-assisted extraction step

set -euo pipefail

WORKSPACE_DIR="${1:-.}"
MEMORY_FILE="$WORKSPACE_DIR/MEMORY.md"
ENGINE_DIR="$WORKSPACE_DIR/memory-engine"

echo "=== openclaw-memory-engine Migration ==="
echo ""

# Step 1: Check for existing MEMORY.md
if [ ! -f "$MEMORY_FILE" ]; then
    echo "No MEMORY.md found at $MEMORY_FILE"
    echo "Creating fresh memory-engine structure..."
fi

# Step 2: Create directory structure
echo "Creating directory structure..."
mkdir -p "$ENGINE_DIR/entities/people"
mkdir -p "$ENGINE_DIR/entities/projects"
mkdir -p "$ENGINE_DIR/entities/preferences"
mkdir -p "$ENGINE_DIR/episodes"
mkdir -p "$ENGINE_DIR/archive"

# Step 3: Backup existing MEMORY.md
if [ -f "$MEMORY_FILE" ]; then
    BACKUP="$MEMORY_FILE.backup.$(date +%Y%m%d-%H%M%S)"
    cp "$MEMORY_FILE" "$BACKUP"
    echo "Backed up MEMORY.md to $BACKUP"
fi

# Step 4: Scan for daily logs
LOG_DIR="$WORKSPACE_DIR/memory"
if [ -d "$LOG_DIR" ]; then
    LOG_COUNT=$(find "$LOG_DIR" -name "*.md" | wc -l)
    echo "Found $LOG_COUNT daily log files in $LOG_DIR"
else
    LOG_COUNT=0
    echo "No daily log directory found at $LOG_DIR"
fi

echo ""
echo "=== Migration Structure Created ==="
echo ""
echo "Directory structure:"
find "$ENGINE_DIR" -type d | sort | while read -r dir; do
    echo "  $dir"
done
echo ""

if [ -f "$MEMORY_FILE" ]; then
    MEMORY_LINES=$(wc -l < "$MEMORY_FILE")
    echo "Existing MEMORY.md: $MEMORY_LINES lines"
    echo ""
    echo "Next steps:"
    echo "  1. The memory engine will extract entities from MEMORY.md on first run"
    echo "  2. Daily logs will be scanned for significant episodes"
    echo "  3. A new MEMORY.md will be auto-generated from the structured store"
    echo "  4. Your original MEMORY.md is preserved at: $BACKUP"
else
    echo "Next steps:"
    echo "  1. Start using the memory engine — it will create entities and episodes"
    echo "     as you work"
    echo "  2. MEMORY.md will be auto-generated each session"
fi

echo ""
echo "Migration complete."
