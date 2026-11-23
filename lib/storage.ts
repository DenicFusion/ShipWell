import {
  deleteObject,
  getDownloadURL,
  ref,
  uploadBytes,
} from "firebase/storage";
import { storage } from "@/lib/firebase";

export interface PreparedPhoto {
  previewUrl: string;
  blob: Blob;
  fallbackDataUrl: string;
}

export async function prepareShipmentPhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith("image/")) {
    throw new Error("Only image files (JPG, PNG, WebP) are allowed.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Each photo must be under 5 MB.");
  }

  return new Promise((resolve, reject) => {
    const img = new Image();
    const objUrl = URL.createObjectURL(file);

    img.onload = () => {
      try {
        const maxSide = 900;
        const ratio = Math.min(1, maxSide / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * ratio));
        const h = Math.max(1, Math.round(img.height * ratio));
        const canvas = document.createElement("canvas");
        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) throw new Error("Canvas unavailable");

        // Drawing onto canvas strips EXIF / GPS metadata before upload
        ctx.drawImage(img, 0, 0, w, h);
        const fallbackDataUrl = canvas.toDataURL("image/jpeg", 0.72);
        canvas.toBlob(
          (blob) => {
            URL.revokeObjectURL(objUrl);
            if (!blob) {
              reject(new Error("Could not encode photo."));
              return;
            }
            const previewUrl = URL.createObjectURL(blob);
            resolve({ previewUrl, blob, fallbackDataUrl });
          },
          "image/jpeg",
          0.72
        );
      } catch (err) {
        URL.revokeObjectURL(objUrl);
        reject(err);
      }
    };

    img.onerror = () => {
      URL.revokeObjectURL(objUrl);
      reject(new Error("Could not process image."));
    };

    img.src = objUrl;
  });
}

function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error(`${label} timed out`)), ms);
    promise.then(
      (val) => {
        clearTimeout(t);
        resolve(val);
      },
      (err) => {
        clearTimeout(t);
        reject(err);
      }
    );
  });
}

export async function uploadShipmentPhotoBlob(params: {
  code: string;
  index: number;
  blob: Blob;
  fallbackDataUrl?: string;
}): Promise<string> {
  const path = `shipments/${params.code}/photos/photo_${params.index + 1}_${Date.now()}.jpg`;
  const storageRef = ref(storage, path);

  try {
    await withTimeout(
      uploadBytes(storageRef, params.blob, {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=31536000",
      }),
      8000,
      "Photo upload"
    );
    return await withTimeout(getDownloadURL(storageRef), 5000, "Photo URL fetch");
  } catch (err) {
    // If Cloud Storage rules or CORS are unavailable, fall back to compressed JPEG under Firestore limit
    if (
      params.fallbackDataUrl &&
      params.fallbackDataUrl.length <= 320000
    ) {
      console.warn(
        "Firebase Storage upload unavailable/timed out; using compressed fallback:",
        err
      );
      return params.fallbackDataUrl;
    }
    throw new Error(
      err instanceof Error
        ? err.message
        : "Could not upload item photo to storage."
    );
  }
}

export async function uploadIdAttachment(params: {
  code: string;
  alertId: string;
  file: File;
}): Promise<{ name: string; url?: string }> {
  const { code, alertId, file } = params;
  const isAllowed =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!isAllowed) {
    throw new Error("Please upload a JPG, PNG, WebP, or PDF document.");
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error("Document must be 5 MB or smaller.");
  }

  const safeName = file.name
    .replace(/[^a-zA-Z0-9._-]/g, "_")
    .slice(0, 80);
  const path = `shipments/${code}/ids/${alertId}_${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);

  try {
    await uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    });
    const url = await getDownloadURL(storageRef);
    return { name: file.name, url };
  } catch (err) {
    console.warn("ID upload to Storage skipped/unavailable:", err);
    return { name: file.name };
  }
}

export async function computeFileSha256(file: Blob): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    if (typeof crypto !== "undefined" && crypto.subtle) {
      const hash = await crypto.subtle.digest("SHA-256", buf);
      return Array.from(new Uint8Array(hash))
        .map((b) => b.toString(16).padStart(2, "0"))
        .join("");
    }
  } catch {
    // ignore hash failure
  }
  return "";
}

export async function uploadPaymentProof(params: {
  uid: string;
  paymentId: string;
  file: File;
}): Promise<{ url: string; name: string; hash: string }> {
  const { uid, paymentId, file } = params;
  const isAllowed =
    file.type.startsWith("image/") || file.type === "application/pdf";
  if (!isAllowed) {
    throw new Error("Proof must be an image (JPG, PNG, WebP) or PDF file.");
  }
  if (file.size > 10 * 1024 * 1024) {
    throw new Error("Payment proof file must be 10 MB or smaller.");
  }
  const hash = await computeFileSha256(file);
  const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80);
  const path = `paymentProofs/${uid}/${paymentId}/${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  await withTimeout(
    uploadBytes(storageRef, file, {
      contentType: file.type || "application/octet-stream",
    }),
    20000,
    "Payment proof upload"
  );
  const url = await withTimeout(
    getDownloadURL(storageRef),
    8000,
    "Payment proof URL fetch"
  );
  return { url, name: file.name, hash };
}

export async function uploadPaymentMethodAsset(params: {
  methodId: string;
  kind: "icon" | "qr";
  file: File;
}): Promise<string> {
  if (!params.file.type.startsWith("image/")) {
    throw new Error("Only image files (PNG, JPG, WebP, SVG) are allowed.");
  }
  if (params.file.size > 5 * 1024 * 1024) {
    throw new Error("Asset image must be 5 MB or smaller.");
  }
  const safeName = params.file.name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 60);
  const path = `paymentMethods/${params.methodId}/${params.kind}_${Date.now()}_${safeName}`;
  const storageRef = ref(storage, path);
  await withTimeout(
    uploadBytes(storageRef, params.file, {
      contentType: params.file.type,
      cacheControl: "public,max-age=31536000",
    }),
    15000,
    "Method asset upload"
  );
  return await withTimeout(getDownloadURL(storageRef), 8000, "Asset URL fetch");
}

export async function uploadDraftPhoto(params: {
  uid: string;
  draftId: string;
  file: File;
}): Promise<{ url: string; storagePath: string; name: string }> {
  const prepared = await prepareShipmentPhoto(params.file);
  const path = `drafts/${params.uid}/${params.draftId}/photo_${Date.now()}.jpg`;
  const storageRef = ref(storage, path);
  try {
    await withTimeout(
      uploadBytes(storageRef, prepared.blob, {
        contentType: "image/jpeg",
        cacheControl: "public,max-age=604800",
      }),
      12000,
      "Draft photo upload"
    );
    const url = await withTimeout(getDownloadURL(storageRef), 6000, "Draft photo URL");
    URL.revokeObjectURL(prepared.previewUrl);
    return { url, storagePath: path, name: params.file.name };
  } catch {
    URL.revokeObjectURL(prepared.previewUrl);
    return {
      url: prepared.fallbackDataUrl,
      storagePath: "",
      name: params.file.name,
    };
  }
}

export async function deleteStorageUrlSafe(url: string): Promise<void> {
  if (!url || url.startsWith("data:") || url.startsWith("blob:")) return;
  try {
    const targetRef = ref(storage, url);
    await deleteObject(targetRef);
  } catch {
    // ignore missing or permission errors on cleanup
  }
}
