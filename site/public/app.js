/*
 * PCB 项目门面：一页两语，零依赖。
 *
 * 字典在 /i18n/{zh,en}.json；页面只用 data-i18n 挂 key，
 * 接口只回 code（不回来中文散文），所以两种语言共用同一套接口。
 */

const FALLBACK_LANG = "zh";
const REPO_URL = "https://github.com/renjianfj163/PCB";

const $ = id => document.getElementById(id);

/** 语言：?lang= → localStorage → navigator.language → zh。 */
function pickLang() {
	const asked = new URLSearchParams(location.search).get("lang");
	if (asked === "zh" || asked === "en") return asked;
	try {
		const saved = localStorage.getItem("pcbSiteLang");
		if (saved === "zh" || saved === "en") return saved;
	} catch {
		// 隐私模式下没有 localStorage，无所谓
	}
	return (navigator.language || "").toLowerCase().startsWith("zh") ? "zh" : "en";
}

const LANG = pickLang();
const dict = {};
const base = {};

function t(key, vars) {
	let text = dict[key];
	if (!text) text = base[key];
	if (!text) text = key;
	if (!vars) return text;
	return text.replace(/\{(\w+)\}/g, (whole, name) =>
		Object.hasOwn(vars, name) ? String(vars[name]) : whole,
	);
}

async function loadDict(lang) {
	const reply = await fetch(`/i18n/${lang}.json`, { cache: "no-cache" });
	if (!reply.ok) throw new Error(`i18n ${reply.status}`);
	return reply.json();
}

function applyDom() {
	document.documentElement.lang = LANG === "zh" ? "zh-CN" : "en";
	document.title = t("meta.title");
	const description = document.querySelector('meta[name="description"]');
	if (description) description.setAttribute("content", t("meta.desc"));

	for (const el of document.querySelectorAll("[data-i18n]")) {
		el.textContent = t(el.dataset.i18n);
	}
	for (const el of document.querySelectorAll("[data-i18n-placeholder]")) {
		el.setAttribute("placeholder", t(el.dataset.i18nPlaceholder));
	}
	for (const el of document.querySelectorAll("[data-i18n-alt]")) {
		el.setAttribute("alt", t(el.dataset.i18nAlt));
	}
	for (const el of document.querySelectorAll("[data-lang]")) {
		const active = el.dataset.lang === LANG;
		el.setAttribute("aria-current", active ? "true" : "false");
		el.setAttribute("href", `?lang=${el.dataset.lang}`);
		el.addEventListener("click", () => {
			try {
				localStorage.setItem("pcbSiteLang", el.dataset.lang);
			} catch {
				// 没关系，下一次还会按 navigator 猜
			}
		});
	}
}

// ——— 下载与版本 ———

const bytes = size => {
	if (!size) return t("download.sizeUnknown");
	const mb = size / 1024 / 1024;
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
};

const when = iso => {
	if (!iso) return "";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

/** 两个版本，只按文件名分；认不出来的照原名列出，不猜、不拼地址。 */
const PACKS = [
	{ key: "packs.desktop.name", test: /(desktop|日常|daily|basic|home)/i },
	{ key: "packs.developer.name", test: /(developer|编程|coding|code|pro)/i },
];

function packOf(name) {
	const hits = PACKS.filter(pack => pack.test.test(name));
	return hits.length === 1 ? hits[0].key : null;
}

function el(tag, className, text) {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

function assetTable(assets) {
	const table = el("table", "assets");
	const head = el("thead");
	const headRow = el("tr");
	for (const key of ["download.col.name", "download.col.size", "download.col.hash", "download.col.action"]) {
		headRow.append(el("th", null, t(key)));
	}
	head.append(headRow);
	const body = el("tbody");
	for (const asset of assets) {
		const row = el("tr");
		row.append(el("td", "mono", asset.name));
		row.append(el("td", null, bytes(asset.size)));
		row.append(
			el("td", "mono", asset.sha256 ? `sha256 ${asset.sha256.slice(0, 16)}…` : t("download.shaHint")),
		);
		const action = el("td");
		const link = el("a", null, t("download.col.action"));
		link.href = asset.url;
		link.rel = "noopener";
		action.append(link);
		row.append(action);
		body.append(row);
	}
	table.append(head, body);
	return table;
}

function packBlock(title, assets, note) {
	const wrap = el("div");
	wrap.append(el("h4", null, title));
	if (note) wrap.append(el("p", "note small", note));
	if (assets.length > 0) wrap.append(assetTable(assets));
	return wrap;
}

function renderReleases(data) {
	const box = $("releases");
	box.textContent = "";
	const list = Array.isArray(data.releases) ? data.releases : [];

	if (list.length === 0) {
		box.append(el("p", null, t("download.empty")));
		const pending = el("ul", "pending");
		for (const pack of PACKS) {
			const row = el("li");
			row.append(el("span", null, t(pack.key)));
			row.append(el("span", null, t("download.soon")));
			pending.append(row);
		}
		box.append(pending);
		const link = el("a", "note small", t("download.cta.releases"));
		link.href = `${REPO_URL}/releases`;
		link.rel = "noopener";
		box.append(link);
		return;
	}

	for (const release of list) {
		const article = el("article", "release");

		const head = el("div", "head");
		head.append(el("span", "ver", release.version || release.tag || "—"));
		if (release.prerelease) head.append(el("span", "badge", t("download.prerelease")));
		const date = when(release.publishedAt);
		if (date) head.append(el("span", "when", t("download.published", { date })));
		article.append(head);

		const assets = Array.isArray(release.assets) ? release.assets : [];
		if (assets.length === 0) {
			article.append(el("p", "note small", t("download.noWindows")));
		} else {
			const groups = new Map(PACKS.map(pack => [pack.key, []]));
			const unknown = [];
			for (const asset of assets) {
				const key = packOf(String(asset.name ?? ""));
				if (key) groups.get(key).push(asset);
				else unknown.push(asset);
			}
			for (const [key, grouped] of groups) {
				if (grouped.length > 0) article.append(packBlock(t(key), grouped));
			}
			if (unknown.length > 0) {
				article.append(packBlock(t("download.unknownTitle"), unknown, t("download.unknownNote")));
			}
		}

		if (release.notes) {
			const notes = el("details", "notes");
			notes.append(el("summary", null, t("download.notes")));
			notes.append(el("pre", null, release.notes));
			article.append(notes);
		}

		const link = el("a", "note small", t("download.github"));
		link.href = release.htmlUrl || `${REPO_URL}/releases`;
		link.rel = "noopener";
		article.append(link);

		box.append(article);
	}
}

/**
 * 页面是纯静态的：没有自己的接口，直接读 GitHub 的公开 API（浏览器可跨域）。
 * 读不到、或仓库还没有发布，就退回「即将发布」+ 发布页链接——不编造下载地址。
 */
const GITHUB_RELEASES = "https://api.github.com/repos/renjianfj163/PCB/releases?per_page=30";

function windowsAssets(release) {
	const assets = Array.isArray(release.assets) ? release.assets : [];
	return assets
		.filter(asset => /windows|win32|\.exe$/i.test(String(asset.name ?? "")))
		.map(asset => {
			const digest = typeof asset.digest === "string" ? asset.digest : "";
			return {
				name: String(asset.name ?? ""),
				size: Number(asset.size ?? 0),
				url: String(asset.browser_download_url ?? ""),
				sha256: /^sha256:[0-9a-f]{64}$/i.test(digest) ? digest.slice(7) : undefined,
			};
		});
}

function toRelease(release) {
	return {
		version: String(release.tag_name ?? release.name ?? ""),
		tag: String(release.tag_name ?? ""),
		publishedAt: release.published_at ?? null,
		notes: String(release.body ?? ""),
		prerelease: Boolean(release.prerelease),
		htmlUrl: String(release.html_url ?? ""),
		assets: windowsAssets(release),
	};
}

async function loadReleases() {
	let list = [];
	try {
		const reply = await fetch(GITHUB_RELEASES, { headers: { accept: "application/vnd.github+json" } });
		if (reply.ok) list = await reply.json();
	} catch (error) {
		console.warn("releases unavailable:", error.message);
	}
	const all = (Array.isArray(list) ? list : []).filter(release => !release.draft).map(toRelease);
	const stable = all.filter(release => !release.prerelease);
	// 正式版优先；只有预发布时才展示预发布，并由页面标明。
	renderReleases({ releases: stable.length > 0 ? stable : all.slice(0, 1) });
}

// ——— 启动 ———

(async () => {
	try {
		const [chosen, fallback] = await Promise.all([loadDict(LANG), loadDict(FALLBACK_LANG)]);
		Object.assign(dict, chosen);
		Object.assign(base, fallback);
	} catch (error) {
		// 字典拿不到时页面仍然可读（HTML 里是中文原文），只是不翻译。
		console.warn("i18n unavailable:", error.message);
	}

	applyDom();
	await loadReleases();
})();
