/**
 * Client-side image resize + JPEG compress for ephemeral E2EE send.
 * Always compresses before chunked MLS send (≤ LIMITS.maxImageBytes).
 */
import { LIMITS } from "@ghostchat/shared";

export type CompressedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg";
  name: string;
  width: number;
  height: number;
};

/** Reject huge source files before decode (memory safety). */
const MAX_SOURCE_BYTES = 20 * 1024 * 1024;

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(new Error("Failed to read image"));
    r.readAsDataURL(file);
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("Failed to decode image"));
    img.src = src;
  });
}

function canvasToJpeg(
  canvas: HTMLCanvasElement,
  quality: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      async (blob) => {
        if (!blob) {
          reject(new Error("JPEG encode failed"));
          return;
        }
        const buf = new Uint8Array(await blob.arrayBuffer());
        resolve(buf);
      },
      "image/jpeg",
      quality
    );
  });
}

function formatLimit(maxBytes: number): string {
  return maxBytes >= 1024 * 1024
    ? `${(maxBytes / (1024 * 1024)).toFixed(0)}MB`
    : `${Math.round(maxBytes / 1024)}KB`;
}

/**
 * Resize so longest edge ≤ maxEdge, then JPEG-compress under maxBytes.
 * Always re-encodes to JPEG (even if source was already small).
 */
export async function compressImageForSend(
  file: File,
  opts?: { maxEdge?: number; maxBytes?: number }
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only images are supported");
  }
  if (file.size > MAX_SOURCE_BYTES) {
    throw new Error("Source image too large (max 20MB file)");
  }

  const maxEdge = opts?.maxEdge ?? LIMITS.maxImageEdgePx;
  const maxBytes = opts?.maxBytes ?? LIMITS.maxImageBytes;

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);

  const srcW = img.naturalWidth || img.width;
  const srcH = img.naturalHeight || img.height;
  if (srcW < 1 || srcH < 1) throw new Error("Invalid image dimensions");

  let edge = Math.min(maxEdge, Math.max(srcW, srcH));
  let w = Math.max(1, Math.round(srcW * (edge / Math.max(srcW, srcH))));
  let h = Math.max(1, Math.round(srcH * (edge / Math.max(srcW, srcH))));

  const canvas = document.createElement("canvas");
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");

  // White background so transparent PNGs don't become black JPEG
  const draw = (dw: number, dh: number) => {
    canvas.width = dw;
    canvas.height = dh;
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, dw, dh);
    ctx.drawImage(img, 0, 0, dw, dh);
  };

  draw(w, h);

  const baseName = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
  const name = `${baseName.slice(0, 60)}.jpg`;

  // Quality ladder — prefer smaller payloads for stable chunked send
  const qualities = [0.78, 0.68, 0.58, 0.48, 0.4, 0.34];
  let bytes = await canvasToJpeg(canvas, qualities[0]!);
  for (const q of qualities) {
    bytes = await canvasToJpeg(canvas, q);
    if (bytes.byteLength <= maxBytes) break;
  }

  // Still too big → scale down longest edge and re-encode
  while (bytes.byteLength > maxBytes && edge > 400) {
    edge = Math.round(edge * 0.72);
    w = Math.max(1, Math.round(srcW * (edge / Math.max(srcW, srcH))));
    h = Math.max(1, Math.round(srcH * (edge / Math.max(srcW, srcH))));
    draw(w, h);
    for (const q of [0.68, 0.52, 0.4, 0.32]) {
      bytes = await canvasToJpeg(canvas, q);
      if (bytes.byteLength <= maxBytes) break;
    }
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(`Could not compress image under ${formatLimit(maxBytes)}`);
  }

  return { bytes, mime: "image/jpeg", name, width: w, height: h };
}
