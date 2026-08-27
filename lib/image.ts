"use client";

// Client-side image compression so phone photos (often 8–15 MB) fit the
// 5 MB storage limit without users having to resize anything themselves.
// Downscales to MAX_DIM on the long edge and re-encodes as JPEG, stepping
// quality down until the result fits.

const MAX_DIM = 1920;
const MAX_BYTES = 5 * 1024 * 1024;
const QUALITY_STEPS = [0.82, 0.7, 0.55, 0.4];

// Square thumbnail URL for a stored place photo, via Supabase Storage's
// on-the-fly render endpoint: a 96px pin thumb is ~3 KB against ~180 KB for
// the stored original, which is what makes photo pins affordable across a
// mapful of markers. URLs we don't serve ourselves pass through untouched.
export function thumbUrl(url: string | null | undefined, size: number): string | null {
  if (!url) return null;
  const OBJECT = "/storage/v1/object/public/";
  if (!url.includes(OBJECT)) return url;
  const rendered = url.replace(OBJECT, "/storage/v1/render/image/public/");
  return `${rendered}?width=${size}&height=${size}&resize=cover&quality=70`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("Couldn't read that image — try a different file.")); };
    img.src = url;
  });
}

function toBlob(canvas: HTMLCanvasElement, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, "image/jpeg", quality));
}

export async function compressImage(file: File): Promise<File> {
  // GIFs would lose animation if re-encoded; pass small ones through untouched.
  if (file.type === "image/gif" && file.size <= MAX_BYTES) return file;
  // Already small and not worth re-encoding.
  if (file.size <= 1024 * 1024) return file;

  const img = await loadImage(file);
  const scale = Math.min(1, MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(img.naturalWidth * scale);
  canvas.height = Math.round(img.naturalHeight * scale);
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Couldn't process the image in this browser.");
  // JPEG has no alpha — flatten transparency onto white instead of black.
  ctx.fillStyle = "#fff";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

  for (const q of QUALITY_STEPS) {
    const blob = await toBlob(canvas, q);
    if (blob && blob.size <= MAX_BYTES) {
      const name = file.name.replace(/\.[^.]+$/, "") + ".jpg";
      return new File([blob], name, { type: "image/jpeg" });
    }
  }
  throw new Error("Couldn't shrink that image under 5 MB — try a different photo.");
}
