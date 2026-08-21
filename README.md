# dsh-session-unarchive

Adds an archived-sessions view and a restore action to the dsh Web GUI — implemented as a **pure Cordis plugin** (host half + client half), with **zero file patches**. It survives dsh upgrades: nothing is written under the dsh install directory.

## What it does

- Adds an **Archived** button at the bottom of the sidebar (beside Settings), showing the archived-session count.
- Clicking it opens a popover panel listing every archived session, with a **title filter** and a per-row **Restore** action.
- Restoring a session returns it to its original workspace position; the panel and the built-in sidebar update automatically via dsh's `host/archived-sessions-changed` event.
- Works in both zh-CN and en locales.

## Install

```bash
cd "$DSH_HOME/profiles/web"          # e.g. ~/.dsh/profiles/web
# add the local plugin dependency
#   "dsh-session-unarchive": "file:plugins/session-unarchive"   → package.json dependencies
# register the entry in cordis.patch.yml:
#   - id: session-unarchive
#     name: dsh-session-unarchive
pnpm install
# restart dsh, then refresh the browser
```

> For a `dsh plugin add`-style install of this exact repo, `dsh plugin add github:dylan121322/dsh-session-unarchive` works as long as the bundle resolver reaches the profile's `node_modules`; the local `file:` form is the most reliable.

## Architecture

Two files under the plugin package:

| File | Role |
|------|------|
| `index.js` | Host half — a Cordis plugin (`apply(ctx)` + `inject: ["webServer","workspaceRegistry"]`) that registers two HTTP routes on `webServer`: `POST /api/session-unarchive/restore` and `GET /api/session-unarchive/list`. |
| `client.js` | Client half — a prebuilt browser bundle (`window.__ModuleLoader__.load({ id, factory })`) that registers a `sidebar.footer.action` slot occupant (`replaceRisk: none`) for the Archived button + panel. |

**How unarchive works without patching dsh.** Archiving in dsh is one-way: a session id is recorded in `~/.dsh/storages/workspace.json` (`global.archivedSessionIds`) and hidden from every view. The host half calls the workspace registry's **runtime methods** (`enqueueOperation` / `requireState` / `setState` — the same internal API the built-in `archiveSession` uses) to remove the id from the archive set and persist it. After `setState`, dsh's own workspace stream detects the change and broadcasts `host/archived-sessions-changed`, so the client store and the built-in sidebar refresh with no extra wiring.

**Data for the UI.** The panel uses the `sidebar.footer.action` slot's standard props: `useWorkspaces((s) => s.archivedSessionIds)` for the archived set and `useSessions((s) => s)` for titles — both already kept live by dsh's client runtime.

**Upgrade resilience.** Because the plugin only touches runtime service methods (and those are detected at load time), a dsh upgrade that renames or removes `enqueueOperation/requireState/setState` fails the plugin's capability check and the endpoint returns a clear 500 — it never corrupts dsh or the registry. No file under the dsh install is ever written, so `npm update @deepseek-ai/dsh` cannot overwrite this plugin.

## Compatibility

Tested on `@deepseek-ai/dsh@0.1.0-rc.8` (web profile). It does not depend on the patched-package layout of the older rc.6-era file-patch build; the runtime-API approach is version-agnostic as long as the registry exposes the three internal methods above.

## Verify

1. Archive any session: the **Archived · n** button appears at the sidebar foot.
2. Click it: the popover lists archived sessions (title filter + per-row **Restore**).
3. Click **Restore**: the session disappears from the panel and reappears in its workspace group; `archivedSessionIds` in `~/.dsh/storages/workspace.json` no longer contains the id.
4. With several archived sessions the list scrolls inside the panel.

## Notes

- The repository previously shipped as a boot-time patcher (file patches over five dsh packages). That design is superseded by this pure-plugin form; the old `patches/`, `originals/`, `apply.sh`, and `cordis.patch.yml` were removed.
- `client.js` is a prebuilt CJS bundle (dsh's client module system). Rebuild it from source with your own `tsdown`/`esbuild` step if you change it; the shipped file is the canonical artifact.
