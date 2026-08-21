// dsh-session-unarchive — client half（纯插件实现，零文件补丁）
//
// 在侧栏底部（sidebar.footer.action，replaceRisk: none）注册「已归档」按钮，
// 点击展开浮层面板，列出已归档会话并提供「恢复」操作。
//
// 数据通路：
//   - 已归档集合：useWorkspaces((s) => s.archivedSessionIds)（standardProps 注入，
//     client-runtime store，随 host/archived-sessions-changed 事件自动同步）
//   - 会话标题：useSessions((s) => s)（SessionListState.byId[id].displayTitle）
//   - 恢复动作：fetch POST /api/session-unarchive/restore（host 端 webServer 路由）
//     成功后无需本地刷新——host 端 setState 广播事件 → store 更新 → 列表自动消失
//
// 本 bundle 为预构建 CJS 格式（dsh 的 client module 系统约定），只依赖平台
// seed word `react`，不依赖任何其他插件的 client bundle。
window.__ModuleLoader__.load({
	id: "dsh-session-unarchive",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		const react = require("react");
		const { createElement: h, Fragment, useEffect, useMemo, useRef, useState } = react;

		// hover 等内联 style 无法表达的状态，注入一段小样式（dsh client 插件惯例）。
		if (typeof document !== "undefined" && document.querySelector('style[data-plugin-css="dsh-session-unarchive"]') === null) {
			const tag = document.createElement("style");
			tag.setAttribute("data-plugin-css", "dsh-session-unarchive");
			tag.textContent = [
				".dsh-unarchive-trigger:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}",
				".dsh-unarchive-restore:hover{background:var(--dsw-alias-interactive-bg-hover)!important;color:var(--dsw-alias-label-primary)!important}"
			].join("\n");
			document.head.appendChild(tag);
		}

		const NS = "sessionUnarchive";
		const zh = {
			"footer.action": "已归档",
			"panel.title": "已归档会话",
			"panel.empty": "没有已归档会话",
			"restore": "恢复",
			"restoring": "恢复中…",
			"restore.error": "恢复失败",
			"search.placeholder": "搜索已归档会话"
		};
		const en = {
			"footer.action": "Archived",
			"panel.title": "Archived sessions",
			"panel.empty": "No archived sessions",
			"restore": "Restore",
			"restoring": "Restoring…",
			"restore.error": "Restore failed",
			"search.placeholder": "Search archived sessions"
		};

		/** 归档箱图标（内联 SVG，避免依赖 primitives bundle）。 */
		function ArchiveIcon({ size = 14 }) {
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, h("path", { d: "M2.5 5.5h11v8a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1v-8Z" }),
				h("path", { d: "M1.5 2.5h13v3h-13v-3Z" }),
				h("path", { d: "M6.5 9h3" }));
		}

		/** 恢复箭头图标。 */
		function RestoreIcon({ size = 14 }) {
			return h("svg", {
				width: size,
				height: size,
				viewBox: "0 0 16 16",
				fill: "none",
				stroke: "currentColor",
				strokeWidth: 1.4,
				strokeLinecap: "round",
				strokeLinejoin: "round",
				"aria-hidden": true
			}, h("path", { d: "M2.5 8a5.5 5.5 0 1 1 1.6 3.9" }),
				h("path", { d: "M2.5 13.5v-4h4" }));
		}

		/**
		 * 侧栏底部「已归档」按钮 + 展开面板。
		 * @param props.wide - 侧栏宽/rail 状态（owner share）。
		 * @param props.useSessions - standardProps：会话列表 store hook。
		 * @param props.useWorkspaces - standardProps：workspace store hook。
		 * @param props.t - locale seat（register 时声明 locale: NS）。
		 */
		function ArchivedPanel({ wide, useSessions, useWorkspaces, t }) {
			const archivedIds = useWorkspaces((state) => state.archivedSessionIds);
			const sessions = useSessions((state) => state);
			const [open, setOpen] = useState(false);
			const [busyId, setBusyId] = useState(null);
			const [error, setError] = useState(null);
			const [query, setQuery] = useState("");
			const rootRef = useRef(null);
			const [anchor, setAnchor] = useState(null);

			const rows = useMemo(() => {
				const set = new Set(archivedIds ?? []);
				const out = [];
				for (const id of sessions.ids) {
					const summary = sessions.byId[id];
					if (summary !== void 0 && !summary.blank && summary.origin !== "subagent" && set.has(id)) {
						out.push({
							id,
							title: summary.displayTitle ?? summary.title ?? id,
							updatedAt: summary.updatedAt ?? 0
						});
					}
				}
				out.sort((a, b) => b.updatedAt - a.updatedAt);
				return out;
			}, [sessions, archivedIds]);

			// 全部恢复（或面板打开期间列表被外部清空）时自动收起。
			useEffect(() => {
				if (open && rows.length === 0 && (archivedIds ?? []).length === 0) setOpen(false);
			}, [open, rows, archivedIds]);

			// 打开时计算锚点：面板左缘贴按钮左缘（侧栏在左侧，向右展开），
			// 底缘在按钮上方 8px。按钮在屏幕左侧，left 锚定保证面板整体在视口内。
			useEffect(() => {
				if (!open) return;
				const el = rootRef.current;
				if (el === null) return;
				const rect = el.getBoundingClientRect();
				setAnchor({ left: Math.max(8, rect.left), bottom: window.innerHeight - rect.top + 8 });
			}, [open]);

			const restore = async (sessionId) => {
				if (busyId !== null) return;
				setBusyId(sessionId);
				setError(null);
				try {
					const response = await fetch("/api/session-unarchive/restore", {
						method: "POST",
						headers: { "content-type": "application/json" },
						body: JSON.stringify({ sessionId })
					});
					const payload = await response.json();
					if (!response.ok || payload?.ok !== true) {
						throw new Error(payload?.error ?? `HTTP ${response.status}`);
					}
					// 成功后不手动刷新：host 广播 host/archived-sessions-changed →
					// workspace store 更新 → rows 自动收缩；全部恢复后面板自动收起。
				} catch (cause) {
					setError(`${t("restore.error")}: ${cause instanceof Error ? cause.message : String(cause)}`);
				} finally {
					setBusyId(null);
				}
			};

			const trimmed = query.trim().toLowerCase();
			const visible = trimmed === "" ? rows : rows.filter((row) => row.title.toLowerCase().includes(trimmed));

			const buttonStyle = {
				cursor: "pointer",
				height: wide ? 42 : 36,
				width: wide ? "100%" : 36,
				color: "var(--dsw-alias-label-secondary)",
				background: "transparent",
				border: "none",
				borderRadius: wide ? 12 : "50%",
				padding: wide ? "0 10px 0 8px" : "0",
				display: "inline-flex",
				alignItems: "center",
				justifyContent: wide ? "flex-start" : "center",
				gap: 6,
				fontSize: 12,
				lineHeight: "18px",
				flex: "none",
				whiteSpace: "nowrap",
				boxSizing: "border-box"
			};

			const panelStyle = {
				position: "fixed",
				zIndex: 60,
				width: 280,
				maxWidth: "calc(100vw - 16px)",
				left: anchor?.left ?? 12,
				bottom: anchor?.bottom ?? 48,
				background: "var(--dsw-alias-bg-overlay)",
				color: "var(--dsw-alias-label-primary)",
				border: "1px solid var(--dsw-alias-border-l2)",
				borderRadius: 12,
				boxShadow: "0 8px 28px rgba(0,0,0,.28)",
				overflow: "hidden",
				display: "flex",
				flexDirection: "column"
			};

			// —— 组装面板内容（中间变量，避免深度嵌套）——
			let panelBody;
			if (rows.length === 0) {
				panelBody = h("div", {
					style: { padding: "14px 12px", fontSize: 12, color: "var(--dsw-alias-label-secondary)" }
				}, t("panel.empty"));
			} else {
				const listItems = visible.map((row) => h("div", {
					key: row.id,
					style: {
						display: "flex", alignItems: "center", gap: 6,
						padding: "5px 8px", borderRadius: 8,
						fontSize: 12
					}
				},
					h("span", {
						style: {
							flex: 1, minWidth: 0,
							whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
							color: "var(--dsw-alias-label-primary)"
						},
						title: row.title
					}, row.title),
					h("button", {
						type: "button",
						disabled: busyId !== null,
						className: "dsh-unarchive-restore",
						"data-unarchive-restore": row.id,
						style: {
							cursor: busyId === null ? "pointer" : "default",
							flex: "none",
							display: "inline-flex", alignItems: "center", gap: 4,
							padding: "3px 8px",
							borderRadius: 6,
							border: "1px solid var(--dsw-alias-border-l2)",
							background: "var(--dsw-alias-bg-layer-1)",
							color: "var(--dsw-alias-label-secondary)",
							fontSize: 11
						},
						onClick: () => restore(row.id)
					},
						h(RestoreIcon, { size: 12 }),
						h("span", null, busyId === row.id ? t("restoring") : t("restore")))));
				const empty = visible.length === 0
					? h("div", { style: { padding: "10px 8px", fontSize: 12, color: "var(--dsw-alias-label-secondary)" } },
						t("panel.empty"))
					: null;
				panelBody = h("div", {
					style: {
						maxHeight: "min(45vh, 380px)",
						overflowY: "auto",
						padding: "0 6px 8px",
						display: "flex",
						flexDirection: "column",
						gap: 2
					}
				}, empty, listItems);
			}

			const searchBox = rows.length > 0
				? h("input", {
					type: "text",
					value: query,
					placeholder: t("search.placeholder"),
					"aria-label": t("search.placeholder"),
					style: {
						margin: "0 10px 8px",
						padding: "6px 10px",
						borderRadius: 8,
						border: "1px solid var(--dsw-alias-border-l2)",
						background: "var(--dsw-alias-bg-layer-1)",
						color: "var(--dsw-alias-label-primary)",
						fontSize: 12,
						outline: "none"
					},
					onChange: (e) => setQuery(e.target.value),
					onKeyDown: (e) => { if (e.key === "Escape") setQuery(""); }
				})
				: null;

			const header = h("div", {
				style: {
					display: "flex", alignItems: "center", justifyContent: "space-between",
					padding: "10px 12px", fontSize: 13, fontWeight: 600
				}
			},
				h("span", null, t("panel.title")),
				h("span", {
					style: { color: "var(--dsw-alias-label-secondary)", fontSize: 12, fontWeight: 400 }
				}, rows.length === 0 ? "" : `${rows.length}`));

			const panel = open ? h("div", {
				style: panelStyle,
				"data-unarchive-panel": true,
				role: "dialog",
				"aria-label": t("panel.title")
			}, header, searchBox, panelBody,
				error !== null && h("div", {
					role: "alert",
					style: { padding: "8px 12px", fontSize: 12, color: "var(--dsw-alias-state-error-primary)" }
				}, error)) : null;

			return h(Fragment, null,
				open && h("div", {
					style: { position: "fixed", inset: 0, zIndex: 59, background: "transparent" },
					onClick: () => setOpen(false)
				}),
				h("button", {
					ref: rootRef,
					type: "button",
					style: buttonStyle,
					className: "dsh-unarchive-trigger",
					title: t("footer.action"),
					"aria-label": t("footer.action"),
					"aria-expanded": open,
					"data-unarchive-trigger": true,
					onClick: () => setOpen((v) => !v)
				}, h(ArchiveIcon, { size: wide ? 14 : 16 }),
					wide && h("span", null, `${t("footer.action")}${rows.length > 0 ? ` · ${rows.length}` : ""}`)),
				panel
			);
		}

		/** cordis service 依赖：slots（附加位注册）+ locale（i18n 字典）。 */
		const inject = ["slots", "locale"];

		/**
		 * 注册入口：i18n + sidebar.footer.action 附加位。
		 * @param ctx - client root context。
		 */
		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "session-unarchive: dictionaries");
			ctx.slots.inject("sidebar.footer.action", () => ctx.slots.register({
				name: "sidebar.footer.action",
				id: "session-unarchive",
				locale: NS
			}, ArchivedPanel));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
