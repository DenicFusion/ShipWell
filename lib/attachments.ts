import { auth } from "@/lib/firebase";

export const MAX_FILES = 3;
export const MAX_FILE_BYTES = 700 * 1024;
export const ACCEPT =
  "image/jpeg,image/png,image/webp,image/gif,application/pdf,text/plain,text/csv,.doc,.docx,.xls,.xlsx";

export interface AttachmentMeta {
  id: string;
  name: string;
  type: string;
  size: number;
}

export interface OutgoingAttachment {
  name: string;
  type: string;
  data: string; // base64, no prefix
  size: number;
  preview?: string; // object URL for images
}

const EXT_TYPES: Record<string, string> = {
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain",
  csv: "text/csv",
  pdf: "application/pdf",
};

function toBase64(buf: ArrayBuffer): string {
  let bin = "";
  const bytes = new Uint8Array(buf);
  for (let i = 0; i < bytes.length; i += 0x8000) {
    bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(bin);
}

async function shrinkImage(file: File): Promise<Blob> {
  if (file.size <= MAX_FILE_BYTES * 0.8 && file.type !== "image/png") return file;
  if (file.type === "image/gif" && file.size <= MAX_FILE_BYTES) return file;
  const bmp = await createImageBitmap(file);
  let scale = Math.min(1, 1600 / Math.max(bmp.width, bmp.height));
  for (let i = 0; i < 4; i++) {
    const c = document.createElement("canvas");
    c.width = Math.round(bmp.width * scale);
    c.height = Math.round(bmp.height * scale);
    const ctx = c.getContext("2d");
    if (!ctx) break;
    ctx.fillStyle = "#fff";
    ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(bmp, 0, 0, c.width, c.height);
    const blob: Blob | null = await new Promise((r) => c.toBlob(r, "image/jpeg", 0.82));
    if (blob && blob.size <= MAX_FILE_BYTES) return blob;
    scale *= 0.7;
  }
  throw new Error(`"${file.name}" is too large. Try a smaller image.`);
}

/** Prepares picked files (compresses images). Throws a readable error. */
export async function prepareFiles(
  picked: File[],
  existing: OutgoingAttachment[]
): Promise<OutgoingAttachment[]> {
  const out: OutgoingAttachment[] = [];
  if (existing.length + picked.length > MAX_FILES) {
    throw new Error(`You can attach up to ${MAX_FILES} files.`);
  }
  for (const f of picked) {
    const ext = f.name.split(".").pop()?.toLowerCase() || "";
    let type = f.type || EXT_TYPES[ext] || "";
    if (type === "image/svg+xml" || !type) throw new Error(`"${f.name}" is not an allowed file type.`);
    let blob: Blob = f;
    if (type.startsWith("image/")) {
      blob = await shrinkImage(f);
      if (blob !== f) type = "image/jpeg";
    } else if (f.size > MAX_FILE_BYTES) {
      throw new Error(`"${f.name}" is too large (max ${Math.round(MAX_FILE_BYTES / 1024)} KB per file).`);
    }
    const name =
      blob !== f ? f.name.replace(/\.[^.]+$/, "") + ".jpg" : f.name;
    out.push({
      name,
      type,
      size: blob.size,
      data: toBase64(await blob.arrayBuffer()),
      preview: type.startsWith("image/") ? URL.createObjectURL(blob) : undefined,
    });
  }
  return out;
}

export function toPayload(list: OutgoingAttachment[]) {
  return list.map(({ name, type, data }) => ({ name, type, data }));
}

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Fetches a protected attachment with the user's token and returns an object URL. */
export async function fetchAttachmentUrl(threadId: string, fileId: string): Promise<string> {
  const token = await auth.currentUser?.getIdToken();
  const res = await fetch(
    `/api/mail/file?thread=${encodeURIComponent(threadId)}&file=${encodeURIComponent(fileId)}`,
    { headers: { Authorization: `Bearer ${token}` } }
  );
  if (!res.ok) throw new Error("Could not open this file.");
  return URL.createObjectURL(await res.blob());
}
