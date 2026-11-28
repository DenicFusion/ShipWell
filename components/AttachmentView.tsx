import React, { useEffect, useState } from "react";
import { FileText, Loader2, Paperclip, X } from "lucide-react";
import toast from "react-hot-toast";
import {
  ACCEPT,
  fmtSize,
  fetchAttachmentUrl,
  prepareFiles,
  type AttachmentMeta,
  type OutgoingAttachment,
} from "@/lib/attachments";

const box: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: 8,
  maxWidth: "100%",
  padding: "7px 10px",
  borderRadius: 10,
  border: "1px solid var(--border)",
  background: "var(--card2)",
  color: "var(--text)",
  fontSize: 12.5,
  cursor: "pointer",
  textAlign: "left",
};

function Item({ threadId, a }: { threadId: string; a: AttachmentMeta }) {
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const isImg = /^image\/(jpeg|png|webp|gif)$/.test(a.type);

  useEffect(() => {
    if (!isImg) return;
    let alive = true;
    let obj = "";
    fetchAttachmentUrl(threadId, a.id)
      .then((u) => {
        obj = u;
        if (alive) setUrl(u);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
      if (obj) URL.revokeObjectURL(obj);
    };
  }, [threadId, a.id, isImg]);

  const open = async () => {
    setBusy(true);
    try {
      const u = url || (await fetchAttachmentUrl(threadId, a.id));
      const link = document.createElement("a");
      link.href = u;
      if (isImg) link.target = "_blank";
      else link.download = a.name;
      link.rel = "noopener";
      document.body.appendChild(link);
      link.click();
      link.remove();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Could not open this file.");
    } finally {
      setBusy(false);
    }
  };

  if (isImg) {
    return (
      <button type="button" onClick={open} style={{ ...box, padding: 0, overflow: "hidden", width: 150, height: 110, justifyContent: "center" }} aria-label={a.name}>
        {url ? (
          <img src={url} alt={a.name} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
        ) : (
          <Loader2 className="w-4 h-4 animate-spin" />
        )}
      </button>
    );
  }
  return (
    <button type="button" onClick={open} style={box}>
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <FileText className="w-4 h-4" />}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0 }}>{a.name}</span>
      <small style={{ color: "var(--muted)" }}>{fmtSize(a.size)}</small>
    </button>
  );
}

export function AttachmentList({ threadId, items }: { threadId: string; items?: AttachmentMeta[] }) {
  if (!items || items.length === 0) return null;
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 10 }}>
      {items.map((a) => (
        <Item key={a.id} threadId={threadId} a={a} />
      ))}
    </div>
  );
}

/** Attach button and the chips for files picked so far. */
export function AttachPicker({
  files,
  onChange,
  disabled,
  compact,
}: {
  files: OutgoingAttachment[];
  onChange: (f: OutgoingAttachment[]) => void;
  disabled?: boolean;
  compact?: boolean;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
      <label
        title="Attach a file"
        aria-label="Attach a file"
        style={{
          ...box,
          ...(compact ? { border: 0, background: "transparent", padding: 6, color: "var(--muted)" } : {}),
          cursor: disabled || busy ? "default" : "pointer",
          opacity: disabled ? 0.5 : 1,
        }}
      >
        {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Paperclip className="w-4 h-4" />}
        {!compact && "Attach"}
        <input
          type="file"
          multiple
          accept={ACCEPT}
          disabled={disabled || busy}
          style={{ display: "none" }}
          onChange={async (e) => {
            const picked = Array.from(e.target.files || []);
            e.target.value = "";
            if (!picked.length) return;
            setBusy(true);
            try {
              onChange([...files, ...(await prepareFiles(picked, files))]);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : "Could not attach the file.");
            } finally {
              setBusy(false);
            }
          }}
        />
      </label>
      {files.map((f, i) => (
        <span key={i} style={{ ...box, cursor: "default" }}>
          {f.preview ? (
            <img src={f.preview} alt="" style={{ width: 22, height: 22, borderRadius: 4, objectFit: "cover" }} />
          ) : (
            <FileText className="w-4 h-4" />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: 140 }}>{f.name}</span>
          <button
            type="button"
            aria-label="Remove"
            onClick={() => onChange(files.filter((_, j) => j !== i))}
            style={{ background: "none", border: 0, color: "var(--muted)", cursor: "pointer", padding: 0, display: "inline-flex" }}
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </span>
      ))}
    </div>
  );
}
