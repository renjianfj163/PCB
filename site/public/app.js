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

/** 服务端只给 code；这句人话由页面出。 */
function errorText(payload, context) {
	const code = payload && typeof payload.code === "string" ? payload.code : "";
	const specific = code === "rate_limited" && context ? t(`${context}.rate`) : "";
	const text = specific || (code ? t(`err.${code}`) : "");
	const fallback = text && text !== `err.${code}` ? text : t("err.generic");
	const detail = payload && typeof payload.detail === "string" && payload.detail ? ` (${payload.detail})` : "";
	return fallback + detail;
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
		const reason = data.reason;
		if (reason && typeof reason.code === "string") {
			const why = t(`download.why.${reason.code}`);
			const detail = typeof reason.detail === "string" && reason.detail ? ` (${reason.detail})` : "";
			box.append(el("p", "note small", (why === `download.why.${reason.code}` ? t("download.why.generic") : why) + detail));
		}
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

async function loadReleases() {
	let data;
	try {
		const reply = await fetch("/api/releases", { cache: "no-cache" });
		data = await reply.json();
	} catch (error) {
		data = { ok: true, releases: [], reason: { code: "github_unreachable", detail: error.message } };
	}
	renderReleases(data);

	// 报告表里的「版本」跟着版本列表走，并且始终有「还没安装」。
	const select = $("bug-version");
	select.textContent = "";
	select.append(el("option", null, t("bugs.notInstalled")));
	for (const release of Array.isArray(data.releases) ? data.releases : []) {
		const option = el(
			"option",
			null,
			`${release.version}${release.prerelease ? t("bugs.prereleaseTag") : ""}`,
		);
		option.value = release.version ?? "";
		select.append(option);
	}
}

// ——— 追问 ———

const history = [];

function turn(role, text) {
	const thread = $("thread");
	const div = el("div", `turn ${role}`);
	div.append(el("span", "who", role === "user" ? t("ask.you") : t("ask.bot")));
	div.append(document.createTextNode(text));
	thread.append(div);
	return div;
}

async function ask(event) {
	event.preventDefault();
	const input = $("question");
	const question = input.value.trim();
	if (!question) return;

	turn("user", question);
	history.push({ role: "user", content: question });
	input.value = "";
	const pending = turn("assistant", t("ask.working"));
	const send = event.target.querySelector("button");
	send.disabled = true;

	try {
		const reply = await fetch("/api/intro", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ question, lang: LANG, history: history.slice(-6) }),
		});
		const data = await reply.json().catch(() => ({}));
		if (data.ok && typeof data.reply === "string") {
			pending.lastChild.textContent = data.reply;
			history.push({ role: "assistant", content: data.reply });
		} else if (data.ok && data.degraded === "no_model") {
			pending.lastChild.textContent = t("ask.degraded");
		} else {
			pending.lastChild.textContent = errorText(data, "ask");
		}
	} catch (error) {
		pending.lastChild.textContent = errorText({ code: "generic", detail: error.message }, "ask");
	} finally {
		send.disabled = false;
		input.focus();
	}
}

// ——— 报告问题 ———

$("bug").addEventListener("submit", async event => {
	event.preventDefault();
	const result = $("bug-result");
	const button = $("bug-send");

	const did = $("bug-did").value.trim();
	const saw = $("bug-saw").value.trim();
	if (!did || !saw) {
		result.hidden = false;
		result.className = "answer warn";
		result.textContent = t("bugs.needFields");
		return;
	}

	button.disabled = true;
	result.hidden = false;
	result.className = "answer";
	result.textContent = t("bugs.sending");

	try {
		const reply = await fetch("/api/bugs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				lang: LANG,
				version: $("bug-version").value,
				system: $("bug-system").value,
				did,
				saw,
				omp: $("bug-omp").value.trim(),
				logs: $("bug-logs").value,
			}),
		});
		const data = await reply.json().catch(() => ({}));
		if (data.ok) {
			result.className = "answer ok";
			result.textContent = "";
			result.append(document.createTextNode(`${t("bugs.okPrefix")}${data.number}: `));
			const link = el("a", null, data.url);
			link.href = data.url;
			link.rel = "noopener";
			result.append(link);
			$("bug").reset();
		} else {
			result.className = "answer warn";
			result.textContent = errorText(data, "bugs");
		}
	} catch (error) {
		result.className = "answer warn";
		result.textContent = errorText({ code: "generic", detail: error.message }, "bugs");
	} finally {
		button.disabled = false;
	}
});

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
	$("ask").addEventListener("submit", ask);
	await loadReleases();
})();
