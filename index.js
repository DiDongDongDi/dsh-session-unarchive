// dsh-session-unarchive — boot-time patcher plugin (host side).
//
// dsh 的会话「归档」是单向操作：GUI 无任何入口找回已归档会话。本插件为
// dsh 0.1.0-rc.6 补齐「已归档」视图 + 恢复按钮，方式是 boot 时把补丁应用到
// 5 个既有插件包的编译产物（cordis patch 层只能覆盖 entry 属性、不能重定向
// 既有插件的实现文件，因此采用文件补丁分发）。
//
// 工作流程（dsh plugin add 安装后）：
//   1. dsh 每次启动都会加载本插件；apply() 校验目标文件并打补丁
//   2. 首次启动：5 个包被应用补丁，打印提示 → 再次重启 dsh 生效
//   3. 之后启动：全部检测为已打补丁，静默通过（幂等）
//   4. 目标文件被本地改过（非 pristine 非已打补丁）→ 拒绝应用并提示
//
// 校验基准：originals/（rc.6 原始文件）md5 一致才打补丁；补丁由
// patches/ 下的 unified diff 重放（与 apply.sh 等价）。
import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const PATCHES = join(HERE, 'patches');
const ORIGINALS = join(HERE, 'originals');

function md5(file) {
  return createHash('md5').update(readFileSync(file)).digest('hex');
}

function listFiles(root, dir = root, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) listFiles(root, full, out);
    else out.push(relative(root, full));
  }
  return out;
}

/** Locate the dsh global install's plugin root. DSH_UNARCHIVE_DEST overrides (tests). */
function locateDest() {
  if (process.env.DSH_UNARCHIVE_DEST) return process.env.DSH_UNARCHIVE_DEST;
  const roots = [];
  try {
    execFileSync('npm', ['root', '-g'], { encoding: 'utf8' })
      .split('\n').map((line) => line.trim()).filter(Boolean)
      .forEach((root) => roots.push(root));
  } catch {
    // npm unavailable — fall through to the static candidates below
  }
  roots.push('/usr/local/lib/node_modules');
  if (process.env.HOME) {
    roots.push(join(process.env.HOME, '.nvm', 'current', 'lib', 'node_modules'));
    roots.push(join(process.env.HOME, '.local', 'lib', 'node_modules'));
  }
  for (const root of roots) {
    const base = join(root, '@deepseek-ai', 'dsh', 'node_modules', '@deepseek-ai');
    if (existsSync(base)) return base;
  }
  return null;
}

/** Apply one package patch. Returns a status string. */
function applyPackage(dest, patchFile) {
  const pkg = patchFile.slice(0, -'.patch'.length);
  let patchedCount = 0;
  let pristineCount = 0;
  const conflicts = [];
  for (const rel of listFiles(join(ORIGINALS, pkg))) {
    const target = join(dest, pkg, rel);
    const src = join(ORIGINALS, pkg, rel);
    if (!existsSync(target)) {
      conflicts.push(`${pkg}/${rel} (missing target)`);
      continue;
    }
    if (md5(src) === md5(target)) {
      pristineCount++;
    } else if (readFileSync(target, 'utf8').includes('unarchiveSession')) {
      patchedCount++;
    } else {
      conflicts.push(`${pkg}/${rel} (locally modified)`);
    }
  }
  if (patchedCount > 0 && pristineCount === 0) return `already patched — skip: ${pkg}`;
  if (conflicts.length > 0) return `SKIPPED: ${pkg} — ${conflicts.join('; ')}`;
  const result = spawnSync('patch', ['-p1', '--silent'], {
    cwd: dest,
    input: readFileSync(join(PATCHES, patchFile)),
    encoding: 'utf8'
  });
  if (result.status === 0) return `applied: ${pkg}`;
  return `patch failed (exit ${result.status}): ${pkg}`;
}

/**
* Boot hook: reconcile the 5 plugin packages against the shipped patches.
* Idempotent and conflict-safe — see the header comment for the workflow.
* @param ctx - cordis context (unused; console output is visible in dsh logs).
*/
export function apply(ctx) {
  const dest = locateDest();
  if (dest === null) {
    console.warn('[dsh-session-unarchive] cannot locate @deepseek-ai/dsh install — no patches applied');
    return;
  }
  const patchFiles = readdirSync(PATCHES).filter((name) => name.endsWith('.patch')).sort();
  const applied = [];
  let conflicts = 0;
  for (const patchFile of patchFiles) {
    const status = applyPackage(dest, patchFile);
    console.log(`[dsh-session-unarchive] ${status}`);
    if (status.startsWith('applied:')) applied.push(status.split(': ')[1]);
    if (status.startsWith('SKIPPED:')) conflicts++;
  }
  if (applied.length > 0) {
    console.log(`[dsh-session-unarchive] ${applied.length} package(s) patched (${applied.join(', ')}). Host files take effect after the NEXT dsh restart; client files after a browser refresh.`);
  } else if (conflicts === 0) {
    console.log('[dsh-session-unarchive] up to date — all packages already patched.');
  } else {
    console.warn('[dsh-session-unarchive] conflicts detected — no patches applied for those packages. See above.');
  }
}
