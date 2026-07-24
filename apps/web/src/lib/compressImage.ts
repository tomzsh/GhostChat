/**
 * Client-side image resize + JPEG compress for ephemeral E2EE send.
 * Keeps payloads under LIMITS.maxImageBytes.
 */
import { LIMITS } from "@ghostchat/shared";

export type CompressedImage = {
  bytes: Uint8Array;
  mime: "image/jpeg";
  name: string;
  width: number;
  height: number;
};

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

/**
 * Resize so longest edge ≤ maxEdge, then JPEG-compress under maxBytes.
 */
export async function compressImageForSend(
  file: File,
  opts?: { maxEdge?: number; maxBytes?: number }
): Promise<CompressedImage> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only images are supported");
  }
  const maxEdge = opts?.maxEdge ?? LIMITS.maxImageEdgePx;
  const maxBytes = opts?.maxBytes ?? LIMITS.maxImageBytes;

  const dataUrl = await readFileAsDataUrl(file);
  const img = await loadImage(dataUrl);

  let w = img.naturalWidth || img.width;
  let h = img.naturalHeight || img.height;
  if (w < 1 || h < 1) throw new Error("Invalid image dimensions");

  const scale = Math.min(1, maxEdge / Math.max(w, h));
  w = Math.max(1, Math.round(w * scale));
  h = Math.max(1, Math.round(h * scale));

  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas not available");
  ctx.drawImage(img, 0, 0, w, h);

  const baseName = (file.name || "image").replace(/\.[^.]+$/, "") || "image";
  const name = `${baseName.slice(0, 60)}.jpg`;

  // Try decreasing quality until under budget
  let quality = 0.82;
  let bytes = await canvasToJpeg(canvas, quality);
  while (bytes.byteLength > maxBytes && quality > 0.35) {
    quality -= 0.12;
    bytes = await canvasToJpeg(canvas, quality);
  }

  // Still too big → scale down further
  let edge = maxEdge;
  while (bytes.byteLength > maxBytes && edge > 480) {
    edge = Math.round(edge * 0.75);
    const s = Math.min(1, edge / Math.max(img.naturalWidth, img.naturalHeight));
    w = Math.max(1, Math.round(img.naturalWidth * s));
    h = Math.max(1, Math.round(img.naturalHeight * s));
    canvas.width = w;
    canvas.height = h;
    ctx.drawImage(img, 0, 0, w, h);
    quality = 0.72;
    bytes = await canvasToJpeg(canvas, quality);
  }

  if (bytes.byteLength > maxBytes) {
    throw new Error(
      `Could not compress image under ${Math.round(maxBytes / 1024)}KB`
    );
  }

  return { bytes, mime: "image/jpeg", name, width: w, height: h };
}
