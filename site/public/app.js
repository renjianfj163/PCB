/* PCB 项目门面：三块，都是固定的中国话，不加载任何第三方脚本。 */

const FIXED = {
	它跑在哪里:
		"跑在你自己的电脑上。默认只监听 127.0.0.1，别的机器连不进来；对话、计划、改文件都由你本机的 omp 完成。这个网站不参与运行，也不托管你的项目。",
	密钥会不会上传:
		"不会。模型密钥用 omp login 存在你本机，PCB 只在本机用它。这个网站不接收、不保存、不转发密钥，也不需要你注册或登录。",
	怎么报告问题:
		"用本页「报告问题」那张表：填系统、你做了什么、你看到了什么，可选的 omp 版本和日志。提交后会在 GitHub 上开一条 Issue，你能拿到编号和链接。请不要贴 API Key 和源码。",
};

const $ = id => document.getElementById(id);

// ——— 固定问答 ———

const answer = $("answer");
$("asks").addEventListener("click", event => {
	const button = event.target.closest("button[data-q]");
	if (!button) return;
	answer.hidden = false;
	answer.className = "answer";
	answer.textContent = FIXED[button.dataset.q] ?? "";
});

// ——— 追问（history 只带最后 6 条，服务端也会再截一次） ———

const thread = $("thread");
const turn = (role, content) => {
	const div = document.createElement("div");
	div.className = `turn ${role}`;
	const who = document.createElement("span");
	who.className = "who";
	who.textContent = role === "user" ? "你" : "介绍助手";
	div.append(who, document.createTextNode(content));
	thread.append(div);
	return div;
};

const history = [];

$("ask").addEventListener("submit", async event => {
	event.preventDefault();
	const input = $("question");
	const question = input.value.trim();
	if (!question) return;

	turn("user", question);
	history.push({ role: "user", content: question });
	input.value = "";
	const pending = turn("assistant", "…");
	const send = event.target.querySelector("button");
	send.disabled = true;

	try {
		const reply = await fetch("/api/intro", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ question, history: history.slice(-6) }),
		});
		const data = await reply.json().catch(() => ({}));
		const text = data.ok ? data.reply : `介绍助手没答上来：${data.reason ?? `HTTP ${reply.status}`}`;
		pending.lastChild.textContent = text;
		if (data.ok) history.push({ role: "assistant", content: text });
	} catch (error) {
		pending.lastChild.textContent = `介绍助手没答上来：${error.message}`;
	} finally {
		send.disabled = false;
		input.focus();
	}
});

// ——— 下载与版本 ———

const bytes = size => {
	if (!size) return "大小未知";
	const mb = size / 1024 / 1024;
	return mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.max(1, Math.round(size / 1024))} KB`;
};

const when = iso => {
	if (!iso) return "";
	const date = new Date(iso);
	return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10);
};

function renderReleases(data) {
	const box = $("releases");
	box.textContent = "";
	const list = Array.isArray(data.releases) ? data.releases : [];

	if (list.length === 0) {
		const p = document.createElement("p");
		p.textContent = "还没有可下载的版本。";
		box.append(p);
		if (data.reason) {
			const why = document.createElement("p");
			why.className = "mini";
			why.textContent = data.reason;
			box.append(why);
		}
		return;
	}

	for (const release of list) {
		const article = document.createElement("article");
		article.className = "release";

		const head = document.createElement("div");
		head.className = "head";
		const version = document.createElement("span");
		version.className = "ver";
		version.textContent = release.version || "未命名版本";
		head.append(version);
		if (release.prerelease) {
			const badge = document.createElement("span");
			badge.className = "badge";
			badge.textContent = "预发布";
			head.append(badge);
		}
		const date = when(release.publishedAt);
		if (date) {
			const span = document.createElement("span");
			span.className = "when";
			span.textContent = `发布于 ${date}`;
			head.append(span);
		}
		article.append(head);

		if (release.notes) {
			const notes = document.createElement("div");
			notes.className = "notes";
			notes.textContent = release.notes;
			article.append(notes);
		}

		const assets = Array.isArray(release.assets) ? release.assets : [];
		if (assets.length === 0) {
			const p = document.createElement("p");
			p.className = "mini";
			p.textContent = "这个版本没有 Windows 安装包。";
			article.append(p);
		} else {
			const table = document.createElement("table");
			table.className = "assets";
			table.innerHTML = "<thead><tr><th>Windows 安装包</th><th>大小</th><th>校验和</th><th></th></tr></thead>";
			const body = document.createElement("tbody");
			for (const asset of assets) {
				const tr = document.createElement("tr");
				const name = document.createElement("td");
				name.className = "mono";
				name.textContent = asset.name;
				const size = document.createElement("td");
				size.textContent = bytes(asset.size);
				const hash = document.createElement("td");
				hash.className = "mono";
				hash.textContent = asset.sha256 ? `sha256 ${asset.sha256.slice(0, 16)}…` : "校验和随发布说明给出";
				const action = document.createElement("td");
				const link = document.createElement("a");
				link.href = asset.url;
				link.rel = "noopener";
				link.textContent = "下载";
				action.append(link);
				tr.append(name, size, hash, action);
				body.append(tr);
			}
			table.append(body);
			article.append(table);
		}

		const link = document.createElement("p");
		link.className = "mini";
		const html = document.createElement("a");
		html.href = release.htmlUrl;
		html.rel = "noopener";
		html.textContent = "在 GitHub 看这个版本";
		link.append(html);
		article.append(link);

		box.append(article);
	}
}

let loaded = { ok: true, releases: [] };

(async () => {
	let data;
	try {
		const reply = await fetch("/api/releases");
		data = await reply.json();
	} catch (error) {
		data = { ok: true, releases: [], reason: `没能连上本站的版本接口（${error.message}）` };
	}
	loaded = data;
	renderReleases(data);

	// 报告表里的「版本」跟着版本列表走，并且始终有「还没安装」。
	const select = $("bug-version");
	for (const release of Array.isArray(data.releases) ? data.releases : []) {
		const option = document.createElement("option");
		option.value = release.version ?? "";
		option.textContent = `${release.version}${release.prerelease ? "（预发布）" : ""}`;
		select.append(option);
	}
})();

// ——— 报告问题 ———

$("bug").addEventListener("submit", async event => {
	event.preventDefault();
	const result = $("bug-result");
	const button = $("bug-send");

	const system = $("bug-system").value;
	const did = $("bug-did").value.trim();
	const saw = $("bug-saw").value.trim();
	if (!did || !saw) {
		result.hidden = false;
		result.className = "answer warn";
		result.textContent = "「我做了什么」和「我看到了什么」都要写。";
		return;
	}

	button.disabled = true;
	result.hidden = false;
	result.className = "answer";
	result.textContent = "正在提交…";

	try {
		const reply = await fetch("/api/bugs", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({
				version: $("bug-version").value,
				system,
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
			result.append(document.createTextNode(`已开 Issue #${data.number}：`));
			const link = document.createElement("a");
			link.href = data.url;
			link.rel = "noopener";
			link.textContent = data.url;
			result.append(link);
			$("bug").reset();
		} else {
			result.className = "answer warn";
			result.textContent = data.reason ?? `还不能提交（HTTP ${reply.status}）`;
		}
	} catch (error) {
		result.className = "answer warn";
		result.textContent = `还不能提交：${error.message}`;
	} finally {
		button.disabled = false;
	}
});
