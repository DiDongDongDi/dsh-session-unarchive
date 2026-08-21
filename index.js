// dsh-session-unarchive — host half（纯插件实现，零文件补丁）
//
// 为 dsh Web GUI 补齐「已归档会话 → 恢复」能力。与旧版（boot-time patcher +
// 文件补丁）不同，本插件不修改任何 dsh 安装文件：
//   - 恢复操作直接调用 workspace registry 的运行时方法（enqueueOperation /
//     requireState / setState，与内置 archiveSession 同构），setState 持久化
//     写盘；随后 apiproxy 的 workspace 流自动检测状态变化并广播
//     host/archived-sessions-changed 事件，内置 UI 与 client store 自动同步。
//   - 提供两个 HTTP 端点（webServer.register，同源 /api/ 前缀）：
//       POST /api/session-unarchive/restore  { sessionId } → 恢复一个会话
//       GET  /api/session-unarchive/list              → 已归档会话清单（兜底/调试）
//   - dsh 升级不会覆盖本插件（位于 $DSH_HOME/profiles/web/plugins）。
//     若上游重构 registry 内部方法，端点返回 500 并给出明确提示，不会破坏 dsh。
//
// 校验基准：registry 实例必须暴露 enqueueOperation/requireState/setState
// （rc.6+ 编译产物均为普通实例方法），缺失即视为不兼容。

const PATH_RESTORE = '/api/session-unarchive/restore';
const PATH_LIST = '/api/session-unarchive/list';

const MAX_BODY_BYTES = 16 * 1024;

/** Collect a JSON request body with a hard size cap. */
function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (chunks.length === 0) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch (error) {
        reject(new Error(`invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function writeJson(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

export const name = 'session-unarchive';

// 硬依赖：等待 webServer（HTTP 路由）与 workspaceRegistry（归档状态）注册
// 后再 apply，避免启动早期 ctx.get 返回 undefined。
export const inject = ['webServer', 'workspaceRegistry'];

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  const registry = ctx.get('workspaceRegistry');
  if (webServer === undefined || registry === undefined) {
    console.warn('[dsh-session-unarchive] webServer/workspaceRegistry unavailable — host half disabled');
    return;
  }

  const registryCapable =
    typeof registry.enqueueOperation === 'function' &&
    typeof registry.requireState === 'function' &&
    typeof registry.setState === 'function';

  // 恢复一个会话：从 registry-global 归档集合移除（id 不在集合中则幂等返回）。
  // 与内置 archiveSession 共用写串行队列与持久化路径；成功后由 apiproxy 的
  // workspace 变更流广播 host/archived-sessions-changed，UI 自动恢复显示。
  async function restoreSession(sessionId) {
    if (!registryCapable) {
      throw new Error(
        'workspace registry no longer exposes enqueueOperation/requireState/setState ' +
        '(dsh 升级改变了内部结构?) — 请升级本插件或反馈上游'
      );
    }
    await registry.enqueueOperation(async () => {
      const state = registry.requireState();
      if (!state.archivedSessionIds.includes(sessionId)) return;
      await registry.setState({
        ...state,
        archivedSessionIds: state.archivedSessionIds.filter((id) => id !== sessionId)
      });
    });
  }

  // 路由注册用 ctx.effect 包裹，返回的 disposer 在插件 stop/update/undefine 时
  // 自动移除路由（避免停用后端点仍生效、或重复注册 duplicate route 报错）。
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PATH_RESTORE,
    handler: async (req, res) => {
      try {
        if (req.method !== 'POST') {
          writeJson(res, 405, { ok: false, error: 'method not allowed (use POST)' });
          return;
        }
        const body = await readJsonBody(req);
        const sessionId = body?.sessionId;
        if (typeof sessionId !== 'string' || sessionId.length === 0 || sessionId.length > 200) {
          writeJson(res, 400, { ok: false, error: 'sessionId must be a non-empty string' });
          return;
        }
        await restoreSession(sessionId);
        writeJson(res, 200, { ok: true, archivedSessionIds: [...registry.archivedSessionIds] });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));

  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: PATH_LIST,
    handler: async (req, res) => {
      try {
        if (req.method !== 'GET' && req.method !== 'HEAD') {
          writeJson(res, 405, { ok: false, error: 'method not allowed (use GET)' });
          return;
        }
        const ids = registry.archivedSessionIds ?? [];
        const sessionQuery = ctx.get('sessionQuery');
        const archived = [];
        for (const id of ids) {
          let title;
          try {
            title = await sessionQuery?.readTitle?.(id);
          } catch {
            title = undefined;
          }
          archived.push({ sessionId: id, title: typeof title === 'string' && title.length > 0 ? title : id });
        }
        writeJson(res, 200, { ok: true, archived });
      } catch (error) {
        writeJson(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    }
  }));

  console.log(`[dsh-session-unarchive] host ready: ${PATH_RESTORE} ${registryCapable ? '(registry OK)' : '(registry API MISSING)'}`);
}
