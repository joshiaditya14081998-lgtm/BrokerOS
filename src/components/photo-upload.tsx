"use client";

import * as React from "react";
import { Upload, Trash2, ImageIcon, X, Loader2, Camera } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { Lightbox } from "@/components/lightbox";

export type Photo = {
  id: string;
  stage: string;
  entityType: string;
  entityId: string;
  url: string;
  thumbnailUrl: string | null;
  caption: string | null;
  createdAt: string;
};

type PhotoUploadProps = {
  entityType: string;
  entityId: string;
  stage: string;
  /** Optional label shown in the header. Defaults to "Photos". */
  label?: string;
  /** Optional hint shown beneath the header. */
  hint?: string;
  /** Called after a successful upload or delete (lets parents refresh). */
  onUploaded?: () => void;
};

export function PhotoUpload({
  entityType,
  entityId,
  stage,
  label = "Photos",
  hint,
  onUploaded,
}: PhotoUploadProps) {
  const { photos, loading, refresh } = usePhotos(entityType, entityId);

  // Pending file picked by the user — show an inline caption field before upload.
  const [pending, setPending] = React.useState<{ file: File; preview: string } | null>(null);
  const [caption, setCaption] = React.useState("");
  const [uploading, setUploading] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);
  const fileInputRef = React.useRef<HTMLInputElement>(null);

  // Lightbox state — null = closed, otherwise index into `photos`.
  const [lightboxIndex, setLightboxIndex] = React.useState<number | null>(null);

  const handlePick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("Please select an image file");
      e.target.value = "";
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      toast.error("Image exceeds 10 MB limit");
      e.target.value = "";
      return;
    }
    const preview = URL.createObjectURL(file);
    setCaption("");
    setPending({ file, preview });
    e.target.value = "";
  };

  const cancelPending = () => {
    if (pending) URL.revokeObjectURL(pending.preview);
    setPending(null);
    setCaption("");
  };

  const upload = async () => {
    if (!pending) return;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append("file", pending.file);
      fd.append("stage", stage);
      fd.append("entityType", entityType);
      fd.append("entityId", entityId);
      if (caption.trim()) fd.append("caption", caption.trim());

      const res = await fetch("/api/photos", { method: "POST", body: fd });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Upload failed: ${res.status} ${txt}`);
      }
      toast.success("Photo uploaded");
      cancelPending();
      await refresh();
      onUploaded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
    }
  };

  const remove = async (id: string) => {
    setDeletingId(id);
    try {
      const res = await fetch(`/api/photos/${id}`, { method: "DELETE" });
      if (!res.ok) {
        const txt = await res.text().catch(() => "");
        throw new Error(`Delete failed: ${res.status} ${txt}`);
      }
      toast.success("Photo removed");
      await refresh();
      onUploaded?.();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Delete failed");
    } finally {
      setDeletingId(null);
    }
  };

  return (
    <div className="glass rounded-xl p-3">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <ImageIcon className="size-3.5 text-muted-foreground" />
          <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
            {label}
          </p>
          {photos.length > 0 ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-600 dark:text-emerald-400">
              <Camera className="size-2.5" />
              {photos.length} photo{photos.length === 1 ? "" : "s"}
            </span>
          ) : (
            <span className="rounded-full bg-card/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              {photos.length}
            </span>
          )}
        </div>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 gap-1.5 px-2 text-[11px]"
          onClick={() => fileInputRef.current?.click()}
          disabled={uploading || !!pending}
        >
          <Upload className="size-3.5" />
          Add photo
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handlePick}
        />
      </div>

      {hint ? <p className="mb-2 text-[11px] text-muted-foreground">{hint}</p> : null}

      {/* Inline caption + upload confirm bar — shows after a file is picked */}
      {pending ? (
        <div className="mb-3 rounded-lg border border-border/60 bg-card/40 p-2">
          <div className="flex items-center gap-2">
            {/* preview thumbnail */}
            <div className="size-12 shrink-0 overflow-hidden rounded-md border border-border/60">
              <img
                src={pending.preview}
                alt="preview"
                className="size-full object-cover"
              />
            </div>
            <Input
              placeholder="Caption (optional)"
              value={caption}
              onChange={(e) => setCaption(e.target.value)}
              className="h-8 text-xs"
              disabled={uploading}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !uploading) upload();
              }}
            />
            <Button
              type="button"
              size="sm"
              className="h-8 shrink-0 gap-1.5 bg-emerald-600 px-2 text-[11px] hover:bg-emerald-700"
              onClick={upload}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {uploading ? "Uploading" : "Upload"}
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-8 shrink-0 px-2 text-[11px]"
              onClick={cancelPending}
              disabled={uploading}
            >
              <X className="size-3.5" />
            </Button>
          </div>
        </div>
      ) : null}

      {/* Grid of thumbnails */}
      {loading ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="aspect-square rounded-lg" />
          ))}
        </div>
      ) : photos.length === 0 && !pending ? (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            className="flex aspect-square flex-col items-center justify-center gap-1 rounded-lg border border-dashed border-border/60 bg-card/30 text-[10px] text-muted-foreground transition-colors hover:border-emerald-500/40 hover:text-emerald-600 dark:hover:text-emerald-400"
          >
            <ImageIcon className="size-4" />
            <span>No photos yet</span>
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          {photos.map((p, i) => (
            <div
              key={p.id}
              role="button"
              tabIndex={0}
              onClick={() => setLightboxIndex(i)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  setLightboxIndex(i);
                }
              }}
              className="group relative aspect-square cursor-zoom-in overflow-hidden rounded-lg border border-border/50 outline-none transition-all hover:border-emerald-500/40 focus-visible:ring-2 focus-visible:ring-emerald-400"
              aria-label={`Open photo ${i + 1} of ${photos.length}${p.caption ? ": " + p.caption : ""}`}
            >
              <img
                src={p.thumbnailUrl || p.url}
                alt={p.caption || "photo"}
                className="size-full object-cover transition-transform duration-200 group-hover:scale-105"
                loading="lazy"
              />
              {p.caption ? (
                <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent px-1.5 pb-1 pt-3">
                  <p className="truncate text-[10px] text-white/90">{p.caption}</p>
                </div>
              ) : null}
              {/* hover overlay with delete */}
              <div className="absolute inset-0 flex items-start justify-end bg-black/0 p-1 opacity-0 transition-all duration-150 group-hover:bg-black/40 group-hover:opacity-100">
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    remove(p.id);
                  }}
                  className="grid size-6 place-items-center rounded-md bg-rose-600/90 text-white shadow-sm transition-colors hover:bg-rose-700"
                  aria-label="Delete photo"
                  disabled={deletingId === p.id}
                >
                  {deletingId === p.id ? (
                    <Loader2 className="size-3 animate-spin" />
                  ) : (
                    <Trash2 className="size-3" />
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {lightboxIndex !== null ? (
        <Lightbox
          photos={photos}
          index={Math.min(lightboxIndex, photos.length - 1)}
          onClose={() => setLightboxIndex(null)}
          onNavigate={setLightboxIndex}
        />
      ) : null}
    </div>
  );
}

/**
 * Lightweight hook for fetching photos by entity.
 * Kept inside this component file so the upload widget stays fully self-contained.
 */
function usePhotos(entityType: string, entityId: string) {
  const [photos, setPhotos] = React.useState<Photo[]>([]);
  const [loading, setLoading] = React.useState(true);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    try {
      const url = `/api/photos?entityType=${encodeURIComponent(entityType)}&entityId=${encodeURIComponent(entityId)}`;
      const res = await fetch(url);
      if (!res.ok) throw new Error(`Failed to load photos: ${res.status}`);
      const data = (await res.json()) as { photos: Photo[] };
      setPhotos(data.photos ?? []);
    } catch {
      setPhotos([]);
    } finally {
      setLoading(false);
    }
  }, [entityType, entityId]);

  React.useEffect(() => {
    refresh();
  }, [refresh]);

  return { photos, loading, refresh, setPhotos };
}

/**
 * Read-only thumbnail strip — for places that just want to show photos
 * (e.g. dispute cards in lists where uploads aren't appropriate).
 */
export function PhotoStrip({
  entityType,
  entityId,
  className,
}: {
  entityType: string;
  entityId: string;
  className?: string;
}) {
  const { photos, loading } = usePhotos(entityType, entityId);
  if (loading) {
    return <Skeleton className={cn("h-16 rounded-lg", className)} />;
  }
  if (photos.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1.5", className)}>
      {photos.slice(0, 6).map((p) => (
        <div
          key={p.id}
          className="size-12 overflow-hidden rounded-md border border-border/50"
        >
          <img src={p.thumbnailUrl || p.url} alt={p.caption || "photo"} className="size-full object-cover" />
        </div>
      ))}
      {photos.length > 6 ? (
        <div className="grid size-12 place-items-center rounded-md border border-border/50 bg-card/40 text-[10px] text-muted-foreground">
          +{photos.length - 6}
        </div>
      ) : null}
    </div>
  );
}
