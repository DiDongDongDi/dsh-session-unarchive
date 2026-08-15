# dsh-session-unarchive

给 [DeepSeek Harness (dsh)](https://github.com/deepseek-ai/deepseek-harness) `0.1.0-rc.6` Web GUI 补齐「已归档」会话管理：**查看已归档会话 + 一键恢复**。

## 背景

dsh 的会话「归档」是单向操作：点击「归档会话」后，会话从侧栏所有视图（分组 / 单列表 / 搜索）中消失，且**没有任何入口找回**。数据并未删除（`session.jsonl.zstd` 仍在 `~/.dsh/sessions/` 下，归档只是把 session id 写入 `~/.dsh/storages/workspace.json` 的 `archivedSessionIds`），但 GUI 无法取消归档。

本仓库补上缺失的另一半：

- 侧栏底部新增「已归档 · N」区块（可展开 / 收起）
- 每个归档会话行显示标题、时间、操作菜单
- 行菜单「恢复会话 / Restore session」：从归档集合移除，会话**回到原工作区原位**（归档时 workspace 槽位保留，unarchive 后自动复原）
- 中英文案齐全（workspace locale namespace）

## 改动清单（9 文件 / 5 包，均为编译产物 lib/*.js）

| 包 | 文件 | 改动 |
|----|------|------|
| `dsh-workspace` | `lib/index.js` | registry 加 `unarchiveSession()` 持久化方法 |
| `dsh-host-apiproxy` | `lib/index.js` | bundler：schema / handler map / response map / fetch 方法 / api 实现 |
| | `lib/types/api/workspace.schema.js` | `workspace.unarchiveSession` request/response zod schema |
| | `lib/types/api-proxy.js` | api 实现（与 bundler 保持一致） |
| | `lib/types/fetch/client.js` | response 校验映射 + `unarchiveSession` 调用方法 |
| | `lib/types/fetch/handler.js` | RPC handler 路由 |
| `dsh-client-connection` | `lib/client.js` | 内联 schema / fetch 映射 / fixture 模拟 |
| `dsh-client-runtime` | `lib/client.js` | workspace manager + service 的 `unarchiveSession` |
| `dsh-client-ui-workspace` | `lib/client.js` | `ArchivedSection` 组件、恢复菜单、i18n、注入 action |

## 使用

```bash
git clone https://github.com/dylan121322/dsh-session-unarchive.git
cd dsh-session-unarchive
./apply.sh          # 或 ./apply.sh check 先干跑
```

apply.sh 会：

1. 定位 dsh 全局安装（`npm root -g` → `@deepseek-ai/dsh/node_modules/@deepseek-ai`）
2. 逐个校验目标文件：原始未改 → 应用；已含 `unarchiveSession` → 跳过；被本地改过且未打补丁 → 拒绝并要求人工处理
3. `patch -p1` 应用，幂等可重复执行

应用后：

```bash
# 1. 重启 dsh（host 端加载新代码）
#    找到 `dsh --profile web` 进程，kill 后重新启动
# 2. 刷新浏览器 http://127.0.0.1:3080
# 3. 侧栏底部出现「已归档」区块，展开 → ⋯ → 恢复会话
```

## 手动重放（不用 apply.sh）

```bash
cd "$(npm root -g)/@deepseek-ai/dsh/node_modules/@deepseek-ai"
for p in /path/to/repo/patches/*.patch; do patch -p1 < "$p"; done
```

## 验证

- 归档一个会话 → 侧栏底部「已归档 · N」出现
- 展开区块 → 该会话行可见
- 行菜单「恢复会话」→ 会话回到原工作区分组、区块消失
- `~/.dsh/storages/workspace.json` 的 `global.archivedSessionIds` 同步移除该 id

## 目录结构

```
├── apply.sh        # 安全重放脚本（幂等、带校验）
├── patches/        # 5 个 unified diff（基于 rc.6 原始产物）
└── originals/      # 9 个原始文件基准（apply.sh 用于校验目标未被本地改过）
```

## 注意事项

- 目标版本：`@deepseek-ai/dsh@0.1.0-rc.6`（patches 基于该版本生成，其他版本行号可能偏移）
- 修改的是 npm 全局安装的**编译产物**：dsh 升级会覆盖改动，升级后需重新 `./apply.sh`
- 更彻底的方案是向上游提交 PR（对应源码目录：`packages/workspace`、`packages/host/apiproxy`、`packages/client/connection`、`packages/client/runtime`、`packages/client/ui-workspace`），本仓库可作为补丁基准参考
