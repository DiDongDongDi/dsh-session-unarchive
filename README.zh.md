# dsh-session-unarchive

为 dsh Web GUI 增加「已归档」视图与「恢复会话」功能，采用**纯 Cordis 插件**实现（host 端 + client 端），**零文件补丁** —— 不写入 dsh 安装目录任何文件，因此 dsh 升级不会覆盖本插件。

## 功能

- 侧栏底部（设置按钮旁）新增「已归档」按钮，显示已归档会话数。
- 点击弹出面板，列出全部已归档会话，支持**标题过滤**与逐条**恢复**。
- 恢复后会话回到原工作区原位；面板与内置侧栏通过 dsh 的 `host/archived-sessions-changed` 事件自动刷新。
- 支持中英文案。

## 安装

```bash
cd "$DSH_HOME/profiles/web"          # 例如 ~/.dsh/profiles/web
# package.json 的 dependencies 增加：
#   "dsh-session-unarchive": "file:plugins/session-unarchive"
# cordis.patch.yml 的 insert 增加：
#   - id: session-unarchive
#     name: dsh-session-unarchive
pnpm install
# 重启 dsh，刷新浏览器
```

> 如需 `dsh plugin add` 方式安装本仓库，`dsh plugin add github:dylan121322/dsh-session-unarchive` 也可用；本地 `file:` 形式最稳妥。

## 原理

插件包内两个文件：

| 文件 | 作用 |
|------|------|
| `index.js` | Host 端插件（`apply(ctx)` + `inject: ["webServer","workspaceRegistry"]`），在 `webServer` 注册两个 HTTP 路由：`POST /api/session-unarchive/restore` 与 `GET /api/session-unarchive/list`。 |
| `client.js` | Client 端预构建浏览器 bundle（`window.__ModuleLoader__.load({ id, factory })`），注册 `sidebar.footer.action` 附加位（`replaceRisk: none`）承载「已归档」按钮与面板。 |

**不补丁如何实现恢复**：dsh 的归档是单向的——会话 id 记入 `~/.dsh/storages/workspace.json`（`global.archivedSessionIds`）后从所有视图隐藏。host 端直接调用 workspace registry 的**运行时方法**（`enqueueOperation` / `requireState` / `setState`，与内置 `archiveSession` 同构）把 id 从归档集合移除并持久化；`setState` 后 dsh 自身的 workspace 变更流会广播 `host/archived-sessions-changed`，client store 与内置侧栏自动刷新，无需额外接线。

**UI 数据来源**：面板使用 `sidebar.footer.action` 槽位的 standard props —— `useWorkspaces((s) => s.archivedSessionIds)`（已归档集合）与 `useSessions((s) => s)`（会话标题），二者均由 dsh client runtime 实时维护。

**升级韧性**：插件只调用运行时 service 方法，且加载时检测其存在性。若 dsh 升级重命名/移除了 `enqueueOperation/requireState/setState`，插件能力检查会失败，接口返回明确的 500 —— 不会破坏 dsh 或 registry。由于从不写 dsh 安装目录文件，`npm update @deepseek-ai/dsh` 无法覆盖本插件。

## 兼容性

在 `@deepseek-ai/dsh@0.1.0-rc.8`（web profile）验证通过。不依赖旧 rc.6 时代文件补丁所针对的包结构；只要 registry 暴露上述三个内部方法，运行时方案即版本无关。

## 验证

1. 归档任意会话：侧栏底部出现「已归档 · n」按钮。
2. 点击：面板列出已归档会话（标题过滤 + 逐条「恢复」）。
3. 点击「恢复」：会话从面板消失、回到原工作区分组；`~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 不再包含该 id。
4. 归档会话较多时，面板列表可内部滚动。

## 备注

- 仓库此前以「启动时文件补丁」（对五个 dsh 包打补丁）分发，现已被纯插件形态取代；旧的 `patches/`、`originals/`、`apply.sh`、`cordis.patch.yml` 已移除。
- `client.js` 为预构建 CJS bundle（dsh client 模块系统约定）。改动后请用自己的 `tsdown`/`esbuild` 步骤重建；随仓库发布的即为构建产物。
