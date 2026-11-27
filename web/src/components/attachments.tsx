/**
 * Prompt pictures for both boxes — the first screen and the conversation.
 * Preparing, the ceilings and the thumbnails are the same in both, so they live here once.
 */

import { useRef, useState } from "react";
import {
	PROMPT_IMAGE_MAX_COUNT,
	PROMPT_IMAGE_MAX_TOTAL_BASE64,
	type PromptImage,
} from "../../../shared/protocol.ts";
import { promptImageSrc } from "../adapters.ts";
import { preparePromptImage } from "../attach.ts";
import { t } from "../i18n.ts";
import { createSessionSlots } from "../sessionSlots.ts";

export interface PromptImages {
	images: PromptImage[];
	preparing: boolean;
	error: string | null;
	dragging: boolean;
	/** Paste, drop and the picker all end up here. */
	addFiles: (files: File[]) => Promise<void>;
	removeImage: (index: number) => void;
	/** Drop this scope's pictures. Defaults to the scope on screen. */
	clear: (scopeId?: string) => void;
	/** Drop target props for the card around the box. */
	dragProps: {
		onDragOver: React.DragEventHandler<HTMLDivElement>;
		onDragLeave: React.DragEventHandler<HTMLDivElement>;
		onDrop: React.DragEventHandler<HTMLDivElement>;
	};
	/** Textarea paste: pictures go to the tray, plain text keeps the browser's own path. */
	onPaste: React.ClipboardEventHandler<HTMLTextAreaElement>;
}

export function usePromptImages(scope = ""): PromptImages {
	// Pictures follow the conversation they were pasted into, same as the text.
	const slots = useRef(createSessionSlots<PromptImage[]>([]));
	const scopeRef = useRef(scope);
	scopeRef.current = scope;
	const [boundScope, setBoundScope] = useState(scope);
	const [images, setImages] = useState<PromptImage[]>([]);
	const [preparing, setPreparing] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [dragging, setDragging] = useState(false);

	if (scope !== boundScope) {
		setBoundScope(scope);
		setImages(slots.current.read(scope));
		setPreparing(false);
		setError(null);
		setDragging(false);
	}

	const addFiles = async (files: File[]) => {
		const key = scopeRef.current;
		if (preparing) return;
		const existing = slots.current.read(key);
		const room = PROMPT_IMAGE_MAX_COUNT - existing.length;
		const complain = (message: string) => {
			if (scopeRef.current === key) setError(message);
		};
		if (files.length > room) complain(t("一条消息最多 4 张图片"));
		if (room <= 0) return;
		setPreparing(true);
		const added: PromptImage[] = [];
		let used = existing.reduce((total, image) => total + image.data.length, 0);
		try {
			for (const file of files.slice(0, room)) {
				try {
					const image = await preparePromptImage(file);
					if (used + image.data.length > PROMPT_IMAGE_MAX_TOTAL_BASE64) {
						complain(t("图片太大，发不出去"));
						break;
					}
					used += image.data.length;
					added.push(image);
				} catch (thrown) {
					complain(t((thrown as Error).message));
				}
			}
		} finally {
			if (added.length > 0) {
				const next = [...slots.current.read(key), ...added];
				slots.current.write(key, next);
				if (scopeRef.current === key) setImages(next);
			}
			if (scopeRef.current === key) setPreparing(false);
		}
	};

	const clear = (scopeId?: string) => {
		const key = scopeId ?? scopeRef.current;
		slots.current.write(key, []);
		if (scopeRef.current === key) {
			setImages([]);
			setError(null);
		}
	};

	return {
		images,
		preparing,
		error,
		dragging,
		addFiles,
		removeImage: index => {
			const key = scopeRef.current;
			const next = slots.current.read(key).filter((_, at) => at !== index);
			slots.current.write(key, next);
			setImages(next);
		},
		clear,
		dragProps: {
			onDragOver: event => {
				if (!event.dataTransfer.types.includes("Files")) return;
				event.preventDefault();
				setDragging(true);
			},
			onDragLeave: event => {
				if (event.currentTarget.contains(event.relatedTarget as Node | null)) return;
				setDragging(false);
			},
			onDrop: event => {
				event.preventDefault();
				setDragging(false);
				void addFiles(Array.from(event.dataTransfer.files));
			},
		},
		onPaste: event => {
			const files: File[] = [];
			for (const item of Array.from(event.clipboardData.items)) {
				if (item.kind !== "file" || !item.type.startsWith("image/")) continue;
				const file = item.getAsFile();
				if (file) files.push(file);
			}
			if (files.length === 0) return;
			event.preventDefault();
			void addFiles(files);
		},
	};
}

/** Thumbnails of what is about to be sent, plus the preparing hint and the last error. */
export function AttachmentTray({
	images,
	preparing,
	error,
	onRemove,
}: {
	images: PromptImage[];
	preparing: boolean;
	error: string | null;
	onRemove: (index: number) => void;
}) {
	return (
		<>
			{images.length > 0 || preparing ? (
				<div className="composer-attachments">
					{images.map((image, index) => (
						<div className="attachment" key={index}>
							<img src={promptImageSrc(image)} alt={t("图片")} />
							<button
								type="button"
								className="attachment-remove"
								title={t("移除这张图片")}
								aria-label={t("移除这张图片")}
								onClick={() => onRemove(index)}
							>
								×
							</button>
						</div>
					))}
					{preparing ? <span className="composer-hint">{t("正在处理图片…")}</span> : null}
				</div>
			) : null}
			{error ? <div className="composer-error">{error}</div> : null}
		</>
	);
}

/** The hidden file input and the button that opens it. */
export function AttachmentPicker({
	disabled,
	onFiles,
}: {
	disabled: boolean;
	onFiles: (files: File[]) => Promise<void>;
}) {
	const input = useRef<HTMLInputElement>(null);
	return (
		<>
			<input
				ref={input}
				type="file"
				accept="image/png,image/jpeg,image/webp"
				multiple
				hidden
				onChange={event => {
					const picked = Array.from(event.target.files ?? []);
					// Same file twice in a row still fires a change event.
					event.target.value = "";
					void onFiles(picked);
				}}
			/>
			<button
				type="button"
				className="ghost composer-attach"
				disabled={disabled}
				title={t("图片")}
				onClick={() => input.current?.click()}
			>
				{t("图片")}
			</button>
		</>
	);
}
