"use client";

import React, { useEffect } from "react";
import { X } from "lucide-react";

export function PhotoZoomModal({
  src,
  alt,
  onClose,
}: {
  src: string;
  alt: string;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="md" role="dialog" aria-modal="true" aria-label={alt}>
      <div className="md-b" onClick={onClose} />
      <div className="md-c img">
        <button className="md-x" onClick={onClose} aria-label="Close zoom">
          <X className="w-4 h-4" />
        </button>
        <img className="zimg" src={src} alt={alt} />
      </div>
    </div>
  );
}
