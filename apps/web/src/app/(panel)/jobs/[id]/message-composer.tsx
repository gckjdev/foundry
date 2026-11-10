"use client";

import { type ClipboardEvent, type FormEvent, useEffect, useRef, useState, useTransition } from "react";
import { messageAction } from "../../../actions";

const MAX_IMAGES = 5;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

type Picked = { key: string; file: File; preview: string };

/** Pasted files sometimes arrive without a MIME type; fall back to the file extension. */
function imageMime(file: File): string | null {
  if (ACCEPTED_IMAGE_TYPES.has(file.type)) return file.type;
  const ext = file.name.toLowerCase().split(".").pop();
  if (ext === "png") return "image/png";
  if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
  if (ext === "webp") return "image/webp";
  return null;
}

/**
 * "Message the agent" composer: text plus up to five images picked or pasted from the
 * clipboard, previewed and removable before the message is sent.
 */
export function MessageComposer({ jobId }: { jobId: string }) {
  const [text, setText] = useState("");
  const [images, setImages] = useState<Picked[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);
  const nextKey = useRef(0);
  const imagesRef = useRef(images);
  imagesRef.current = images;

  // Object URLs live until an image is removed or the composer unmounts.
  useEffect(
    () => () => {
      for (const image of imagesRef.current) URL.revokeObjectURL(image.preview);
    },
    [],
  );

  const addFiles = (incoming: File[]) => {
    let message: string | null = null;
    const picked: Picked[] = [];
    for (const file of incoming) {
      if (!imageMime(file)) {
        message ??= "Images must be PNG, JPEG or WebP.";
        continue;
      }
      if (file.size > MAX_IMAGE_BYTES) {
        message ??= "Each image must be 5 MB or smaller.";
        continue;
      }
      picked.push({ key: `image-${nextKey.current++}`, file, preview: URL.createObjectURL(file) });
    }
    const room = Math.max(0, MAX_IMAGES - images.length);
    if (picked.length > room) message ??= `You can attach at most ${MAX_IMAGES} images.`;
    for (const extra of picked.slice(room)) URL.revokeObjectURL(extra.preview);
    if (picked.length) setImages((prev) => [...prev, ...picked.slice(0, room)]);
    setError(message);
  };

  const remove = (key: string) => {
    setImages((prev) => {
      const hit = prev.find((image) => image.key === key);
      if (hit) URL.revokeObjectURL(hit.preview);
      return prev.filter((image) => image.key !== key);
    });
  };

  const onPaste = (event: ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(event.clipboardData.items)
      .filter((item) => item.kind === "file" && item.type.startsWith("image/"))
      .map((item) => item.getAsFile())
      .filter((file): file is File => file !== null);
    if (!files.length) return;
    addFiles(files);
    // Plain text in the same clipboard still pastes into the textarea.
    if (!event.clipboardData.getData("text/plain")) event.preventDefault();
  };

  const send = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) return;
    const form = new FormData();
    form.set("jobId", jobId);
    form.set("text", text);
    for (const image of images) form.append("images", image.file);
    setError(null);
    startTransition(async () => {
      try {
        const result = await messageAction(form);
        if (!result.ok) {
          setError(result.error);
          return;
        }
        for (const image of images) URL.revokeObjectURL(image.preview);
        setImages([]);
        setText("");
      } catch {
        setError("Could not send the message. Try again.");
      }
    });
  };

  const canSend = !pending && (text.trim().length > 0 || images.length > 0);

  return (
    <form className="stack" onSubmit={send}>
      <textarea
        name="text"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onPaste={onPaste}
        placeholder="Guidance, a correction, or a follow-up change. Paste screenshots with ⌘V."
        disabled={pending}
      />
      {images.length ? (
        <div className="row">
          {images.map((image) => (
            <div
              key={image.key}
              style={{
                position: "relative",
                border: "1px solid var(--line-strong)",
                borderRadius: 6,
                padding: 4,
                lineHeight: 0,
              }}
            >
              {/* biome-ignore lint/performance/noImgElement: local object URL preview */}
              <img
                src={image.preview}
                alt={image.file.name || "Pasted image"}
                style={{ width: 84, height: 84, objectFit: "cover", borderRadius: 4, display: "block" }}
              />
              <button
                type="button"
                onClick={() => remove(image.key)}
                aria-label={`Remove ${image.file.name || "image"}`}
                title="Remove image"
                style={{
                  position: "absolute",
                  top: 2,
                  right: 2,
                  padding: "0 5px",
                  lineHeight: 1.4,
                  background: "var(--bg-raised)",
                }}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      ) : null}
      {error ? (
        <div className="small" style={{ color: "var(--bad)" }} role="alert">
          {error}
        </div>
      ) : null}
      <div className="row">
        <button type="button" onClick={() => fileInput.current?.click()} disabled={pending}>
          Attach images
        </button>
        <input
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          hidden
          onChange={(event) => {
            addFiles(Array.from(event.target.files ?? []));
            event.target.value = "";
          }}
        />
        <button className="primary" type="submit" disabled={!canSend}>
          {pending ? "Sending…" : "Send"}
        </button>
        <span className="faint small">Up to {MAX_IMAGES} images, 5 MB each. You can paste screenshots.</span>
      </div>
    </form>
  );
}
