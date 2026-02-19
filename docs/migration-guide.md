# Migration Guide

## Migrating from Flat MEMORY.md

If you have an existing OpenClaw setup with a flat `MEMORY.md`, follow these
steps to migrate to the structured memory engine.

### Automated Migration

```bash
# Install the plugin
openclaw plugin install openclaw-memory-engine

# Run the migration script
./scripts/migrate.sh ~/.openclaw/workspace
```

The migration script:
1. Creates the `memory-engine/` directory structure
2. Backs up your original `MEMORY.md` as `MEMORY.md.backup.YYYYMMDD-HHMMSS`
3. Scans your daily logs (`memory/YYYY-MM-DD.md`) for episode count
4. Prints next steps

### Manual Entity Extraction

After running the migration script, the agent will automatically extract
entities from your existing MEMORY.md on the first session. You can also
do this manually by asking:

> "Please read my MEMORY.md.backup and extract the key people, projects,
> and preferences into the memory-engine entity format."

### Migrating Daily Logs

To migrate your historical daily logs into episodes:

> "Please scan my memory/ directory and create episode summaries for
> any significant events in the last 30 days."

### Verifying Migration

After migration:

```bash
./scripts/dashboard.sh ~/.openclaw/workspace
```

You should see entity and episode counts in the output.

## Starting Fresh

If you're starting without existing memories, no migration is needed.
The memory engine will build up its store as you work.

The directory structure is created automatically on first use:

```
memory-engine/
├── entities/
│   ├── people/
│   ├── projects/
│   └── preferences/
├── episodes/
└── archive/
```

## Rollback

If you need to revert to the flat MEMORY.md:

1. Restore your backup: `cp MEMORY.md.backup.* MEMORY.md`
2. Disable the plugin in `openclaw.json`

All your entity and episode files remain in `memory-engine/` and
can be re-imported if you re-enable the plugin later.

## Exporting Memories

To export all memories as JSON (for backup or analysis):

```bash
./scripts/export.sh ~/.openclaw/workspace my-backup.json
```
