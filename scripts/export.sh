#!/usr/bin/env bash
#
# export.sh — Export memories as JSON for backup or analysis
#
# Usage: ./scripts/export.sh [workspace_dir] [output_file]

set -euo pipefail

WORKSPACE_DIR="${1:-.}"
OUTPUT_FILE="${2:-memory-export-$(date +%Y%m%d).json}"
ENGINE_DIR="$WORKSPACE_DIR/memory-engine"

echo "=== Memory Export ==="

if [ ! -d "$ENGINE_DIR" ]; then
    echo "Error: No memory-engine directory found at $ENGINE_DIR"
    exit 1
fi

# Build JSON output
echo "{" > "$OUTPUT_FILE"
echo '  "exportDate": "'$(date -Iseconds)'",' >> "$OUTPUT_FILE"
echo '  "entities": [' >> "$OUTPUT_FILE"

# Export entities
FIRST=true
for type_dir in "$ENGINE_DIR/entities"/*/; do
    if [ ! -d "$type_dir" ]; then continue; fi
    for file in "$type_dir"*.md; do
        if [ ! -f "$file" ]; then continue; fi
        if [ "$FIRST" = true ]; then
            FIRST=false
        else
            echo "," >> "$OUTPUT_FILE"
        fi
        # Simple conversion: wrap file content as JSON string
        RELPATH="${file#$ENGINE_DIR/}"
        CONTENT=$(cat "$file" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')
        printf '    {"path": "%s", "content": %s}' "$RELPATH" "$CONTENT" >> "$OUTPUT_FILE"
    done
done

echo "" >> "$OUTPUT_FILE"
echo '  ],' >> "$OUTPUT_FILE"
echo '  "episodes": [' >> "$OUTPUT_FILE"

# Export episodes
FIRST=true
for month_dir in "$ENGINE_DIR/episodes"/*/; do
    if [ ! -d "$month_dir" ]; then continue; fi
    for file in "$month_dir"*.md; do
        if [ ! -f "$file" ]; then continue; fi
        if [ "$FIRST" = true ]; then
            FIRST=false
        else
            echo "," >> "$OUTPUT_FILE"
        fi
        RELPATH="${file#$ENGINE_DIR/}"
        CONTENT=$(cat "$file" | python3 -c "import sys,json; print(json.dumps(sys.stdin.read()))" 2>/dev/null || echo '""')
        printf '    {"path": "%s", "content": %s}' "$RELPATH" "$CONTENT" >> "$OUTPUT_FILE"
    done
done

echo "" >> "$OUTPUT_FILE"
echo '  ]' >> "$OUTPUT_FILE"
echo "}" >> "$OUTPUT_FILE"

echo "Exported to: $OUTPUT_FILE"
ENTITY_COUNT=$(grep -c '"path"' "$OUTPUT_FILE" 2>/dev/null || echo "0")
echo "Total items: $ENTITY_COUNT"
