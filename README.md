# dsh-session-unarchive

Adds an archived-sessions view and a restore action to the dsh Web GUI.

## What it does

- Shows an **Archived** section at the bottom of the sidebar, listing every archived session.
- Adds a **Restore session** menu item that unarchives a session and returns it to its original position in its workspace.
- The expanded section has a **title filter** (search box) that narrows the archived list as you type — the header shows `matched/total` while filtering.
- With many archived sessions the expanded list is **internally scrollable**, so a long archive never pushes the rest of the sidebar out of view.
- Works in both zh-CN and en locales.

## Install

```bash
dsh plugin add github:dylan121322/dsh-session-unarchive
```

## Activate

1. Restart dsh. The first boot applies the patches to five dsh packages and prints a notice.
2. Restart dsh once more (host files take effect after that).
3. Refresh the browser at http://127.0.0.1:3080.

Every later boot detects the patches as applied and stays quiet. The plugin is idempotent: it never re-applies or corrupts files, and it refuses to touch targets that were modified locally.

## How it works

dsh 0.1.0-rc.6 archives sessions one-way: the GUI hides them from every view and offers no way back. The data is never deleted — the session id is only recorded in `~/.dsh/storages/workspace.json` (`global.archivedSessionIds`).

The cordis patch layer can override entry properties but cannot redirect an existing plugin's implementation file, so this bundle ships file patches instead. The plugin entry (`index.js`) runs at boot, verifies each target against the pristine originals in `originals/`, and applies the diffs in `patches/`.

Patched packages:

| Package | Change |
|---------|--------|
| `dsh-workspace` | Adds `unarchiveSession()` to the workspace registry. |
| `dsh-host-apiproxy` | Adds the `workspace.unarchiveSession` RPC end to end. |
| `dsh-client-connection` | Adds fetch mapping and fixture support. |
| `dsh-client-runtime` | Adds manager and service methods. |
| `dsh-client-ui-workspace` | Adds the archived section, restore menu, and i18n. |

## Manual fallback

If `dsh plugin add` is not an option, `./apply.sh` applies the same patches directly (`./apply.sh check` for a dry run).

## Compatibility

Targets `@deepseek-ai/dsh@0.1.0-rc.6`. Patches are generated against that version's build output; other versions may not apply. A dsh upgrade overwrites the patched files — re-run `dsh plugin add` (or `./apply.sh`) after upgrading.

## Verify

1. Archive any session: the **Archived** section appears at the bottom of the sidebar.
2. Expand it and pick **Restore session** from the row menu.
3. The session returns to its workspace group, the section disappears, and `archivedSessionIds` in `~/.dsh/storages/workspace.json` no longer contains the id.
4. With several archived sessions, expand the section: a search field appears above the list — type to filter by title (the header shows `matched/total`), and scroll inside the list when it overflows the `max-height`.
