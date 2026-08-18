# dsh-session-unarchive

为 dsh Web GUI 增加「已归档」视图与「恢复会话」功能。

## 功能

- 在侧栏底部显示「已归档」区块，列出所有已归档会话。
- 行菜单提供「恢复会话」，取消归档后会话回到原工作区原位。
- 展开区块后有**标题搜索框**，输入即过滤；过滤时区块头部显示「命中/总数」。
- 归档会话较多时列表**内部可上下滚动**（max-height + overflow-y），长归档不会把侧栏其他内容挤出视口。
- 支持中英文案。

## 安装

```bash
dsh plugin add github:dylan121322/dsh-session-unarchive
```

## 生效步骤

1. 重启 dsh。首次启动会把补丁应用到 5 个 dsh 包并打印提示。
2. 再重启一次 dsh（host 端文件在之后生效）。
3. 刷新浏览器 http://127.0.0.1:3080。

之后的每次启动会检测到补丁已应用、静默通过。插件幂等：不会重复应用或破坏文件，目标文件被本地改过时拒绝应用。

## 原理

dsh 0.1.0-rc.6 的会话归档是单向操作：GUI 从所有视图隐藏已归档会话，且没有找回入口。数据并未删除——会话 id 只是被记入 `~/.dsh/storages/workspace.json`（`global.archivedSessionIds`）。

cordis patch 层只能覆盖条目属性、不能重定向既有插件的实现文件，因此本插件以文件补丁分发。插件入口（`index.js`）在启动时运行：用 `originals/` 里的 rc.6 原始文件校验每个目标，再用 `patches/` 里的 diff 打补丁。

补丁覆盖的包：

| 包 | 改动 |
|----|------|
| `dsh-workspace` | registry 增加 `unarchiveSession()`。 |
| `dsh-host-apiproxy` | 增加 `workspace.unarchiveSession` RPC 全链路。 |
| `dsh-client-connection` | 增加 fetch 映射与 fixture 模拟。 |
| `dsh-client-runtime` | 增加 manager 与 service 方法。 |
| `dsh-client-ui-workspace` | 增加已归档区块、恢复菜单与 i18n。 |

## 手动兜底

不用 `dsh plugin add` 时，可直接运行 `./apply.sh`（`./apply.sh check` 为干跑），效果相同。

## 兼容性

面向 `@deepseek-ai/dsh@0.1.0-rc.6`，补丁基于该版本的构建产物生成，其他版本可能无法应用。dsh 升级会覆盖补丁文件——升级后重新 `dsh plugin add`（或 `./apply.sh`）即可。

## 验证

1. 归档任意会话：侧栏底部出现「已归档」区块。
2. 展开区块，行菜单选择「恢复会话」。
3. 会话回到原工作区分组、区块消失，`~/.dsh/storages/workspace.json` 的 `archivedSessionIds` 不再包含该 id。
4. 有多个归档会话时展开区块：列表上方出现搜索框——输入标题关键字过滤（头部显示「命中/总数」）；列表超出 `max-height` 时可内部滚动。
