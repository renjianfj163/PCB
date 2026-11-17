/**
 * Small Markdown renderer: fenced code, headings, lists, quotes, inline code,
 * bold/italic, links. No dependency, no HTML injection (text nodes only).
 */

import type { ReactNode } from "react";

function inline(text: string, keyBase: string): ReactNode[] {
	const nodes: ReactNode[] = [];
	const pattern = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g;
	let last = 0;
	let match: RegExpExecArray | null;
	let index = 0;
	while ((match = pattern.exec(text)) !== null) {
		if (match.index > last) nodes.push(text.slice(last, match.index));
		const token = match[0];
		const key = `${keyBase}-${index++}`;
		if (token.startsWith("`")) {
			nodes.push(<code key={key}>{token.slice(1, -1)}</code>);
		} else if (token.startsWith("**")) {
			nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>);
		} else if (token.startsWith("[")) {
			const link = /\[([^\]]+)\]\(([^)]+)\)/.exec(token);
			nodes.push(
				<a key={key} href={link?.[2] ?? "#"} target="_blank" rel="noreferrer">
					{link?.[1] ?? token}
				</a>,
			);
		} else {
			nodes.push(<em key={key}>{token.slice(1, -1)}</em>);
		}
		last = match.index + token.length;
	}
	if (last < text.length) nodes.push(text.slice(last));
	return nodes;
}

export function Markdown({ text }: { text: string }) {
	const lines = text.replace(/\r\n/g, "\n").split("\n");
	const blocks: ReactNode[] = [];
	let index = 0;
	let key = 0;

	while (index < lines.length) {
		const line = lines[index] ?? "";

		if (line.trimStart().startsWith("```")) {
			const code: string[] = [];
			const language = line.trim().slice(3).trim();
			index++;
			while (index < lines.length && !(lines[index] ?? "").trimStart().startsWith("```")) {
				code.push(lines[index] ?? "");
				index++;
			}
			index++;
			blocks.push(
				<pre key={`b${key++}`} className="code-block" data-language={language || undefined}>
					<code>{code.join("\n")}</code>
				</pre>,
			);
			continue;
		}

		if (/^#{1,6}\s/.test(line)) {
			const level = /^#+/.exec(line)?.[0].length ?? 1;
			const content = line.replace(/^#+\s*/, "");
			const Tag = (level <= 2 ? "h3" : "h4") as "h3" | "h4";
			blocks.push(<Tag key={`b${key++}`}>{inline(content, `h${key}`)}</Tag>);
			index++;
			continue;
		}

		if (line.includes("|") && /^\s*\|?[\s:-]+\|[\s:|-]*$/.test(lines[index + 1] ?? "")) {
			const cells = (row: string) => row.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|").map(cell => cell.trim());
			const head = cells(line);
			const rows: string[][] = [];
			index += 2;
			while (index < lines.length && (lines[index] ?? "").includes("|")) {
				rows.push(cells(lines[index] ?? ""));
				index++;
			}
			blocks.push(
				<div className="md-table-wrap" key={`b${key++}`}>
					<table className="md-table">
						<thead>
							<tr>
								{head.map((cell, cellIndex) => (
									<th key={cellIndex}>{inline(cell, `th${key}-${cellIndex}`)}</th>
								))}
							</tr>
						</thead>
						<tbody>
							{rows.map((row, rowIndex) => (
								<tr key={rowIndex}>
									{row.map((cell, cellIndex) => (
										<td key={cellIndex}>{inline(cell, `td${key}-${rowIndex}-${cellIndex}`)}</td>
									))}
								</tr>
							))}
						</tbody>
					</table>
				</div>,
			);
			continue;
		}

		if (/^\s*([-*+]|\d+\.)\s/.test(line)) {
			const ordered = /^\s*\d+\./.test(line);
			const items: string[] = [];
			while (index < lines.length && /^\s*([-*+]|\d+\.)\s/.test(lines[index] ?? "")) {
				items.push((lines[index] ?? "").replace(/^\s*([-*+]|\d+\.)\s+/, ""));
				index++;
			}
			const ListTag = ordered ? "ol" : "ul";
			blocks.push(
				<ListTag key={`b${key++}`}>
					{items.map((item, itemIndex) => (
						<li key={itemIndex}>{inline(item, `li${key}-${itemIndex}`)}</li>
					))}
				</ListTag>,
			);
			continue;
		}

		if (/^\s*>\s?/.test(line)) {
			const quote: string[] = [];
			while (index < lines.length && /^\s*>\s?/.test(lines[index] ?? "")) {
				quote.push((lines[index] ?? "").replace(/^\s*>\s?/, ""));
				index++;
			}
			blocks.push(<blockquote key={`b${key++}`}>{inline(quote.join(" "), `q${key}`)}</blockquote>);
			continue;
		}

		if (!line.trim()) {
			index++;
			continue;
		}

		const paragraph: string[] = [];
		while (index < lines.length && (lines[index] ?? "").trim() && !/^\s*([-*+]|\d+\.)\s/.test(lines[index] ?? "")) {
			if ((lines[index] ?? "").trimStart().startsWith("```")) break;
			paragraph.push(lines[index] ?? "");
			index++;
		}
		blocks.push(<p key={`b${key++}`}>{inline(paragraph.join("\n"), `p${key}`)}</p>);
	}

	return <div className="markdown">{blocks}</div>;
}
