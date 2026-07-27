"use client";

/**
 * Imágenes de un servicio del file: voucher, comprobante de reserva, ficha del hotel.
 * Viven en el bucket PRIVADO `attachments` con path {agency_id}/files/{file_id}/{uuid}.{ext}
 * (la RLS de storage exige que la primera carpeta sea la agencia).
 * Se ven con signed URLs de una hora, pedidas on demand y cacheadas por path.
 */

import * as React from "react";
import { toast } from "sonner";
import { ChevronLeft, ChevronRight, ImageOff, ImagePlus, Loader2, X } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { ServiceImage } from "@/lib/types";

const BUCKET = "attachments";
const MAX_IMAGES = 6;
const MAX_BYTES = 8 * 1024 * 1024;
const SIGNED_TTL = 3600;

/* ───────────────────────── signed URLs ───────────────────────── */

const urlCache = new Map<string, { url: string; expiresAt: number }>();

async function signedUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const supabase = createClient();
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return null;
  // margen de un minuto para no servir un link que expira mientras carga
  urlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000 });
  return data.signedUrl;
}

/** { path → url } para los paths pedidos. `enabled: false` no dispara nada (lightbox cerrado). */
function useSignedUrls(paths: string[], enabled = true) {
  const key = paths.join("\n");
  const [urls, setUrls] = React.useState<Record<string, string | null>>({});

  React.useEffect(() => {
    if (!enabled || !key) return;
    let alive = true;
    const list = key.split("\n");
    (async () => {
      const entries = await Promise.all(
        list.map(async (p) => [p, await signedUrl(p)] as const),
      );
      if (!alive) return;
      setUrls((prev) => {
        const next = { ...prev };
        for (const [p, u] of entries) next[p] = u;
        return next;
      });
    })();
    return () => {
      alive = false;
    };
  }, [key, enabled]);

  return urls;
}

/* ───────────────────────── thumbnail ───────────────────────── */

function Thumb({
  url,
  alt,
  className,
}: {
  url: string | null | undefined;
  alt: string;
  className?: string;
}) {
  if (url === undefined) {
    return (
      <span className={cn("flex items-center justify-center bg-sand-soft", className)}>
        <Loader2 className="size-4 animate-spin text-ink-faint" />
      </span>
    );
  }
  if (url === null) {
    return (
      <span className={cn("flex items-center justify-center bg-sand-soft", className)}>
        <ImageOff className="size-4 text-ink-faint" strokeWidth={1.9} />
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={alt} className={cn("object-cover", className)} loading="lazy" />
  );
}

/* ───────────────────────── campo de carga ─────────────────────────
   Zona de subida con drag & drop + thumbnails cuadradas. El valor es
   controlado: guarda paths, el guardado real lo hace addService/updateService. */

export function ServiceImagesField({
  agencyId,
  fileId,
  value,
  onChange,
  onUploadingChange,
  max = MAX_IMAGES,
  className,
}: {
  agencyId: string;
  fileId: string;
  value: ServiceImage[];
  onChange: (images: ServiceImage[]) => void;
  /** avisa al formulario que hay fotos en vuelo, para no dejar guardar sin ellas */
  onUploadingChange?: (uploading: boolean) => void;
  max?: number;
  className?: string;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [pending, setPending] = React.useState(0);
  const [dragging, setDragging] = React.useState(false);

  // el upload es async: leemos el valor/callback más frescos, no los del render
  const valueRef = React.useRef(value);
  const onChangeRef = React.useRef(onChange);
  const onUploadingRef = React.useRef(onUploadingChange);
  React.useEffect(() => {
    valueRef.current = value;
    onChangeRef.current = onChange;
    onUploadingRef.current = onUploadingChange;
  });

  // contador en ref: dos tandas seguidas no pueden leer un `pending` viejo
  const pendingRef = React.useRef(0);
  const bumpPending = React.useCallback((delta: number) => {
    pendingRef.current = Math.max(0, pendingRef.current + delta);
    setPending(pendingRef.current);
  }, []);

  React.useEffect(() => {
    onUploadingRef.current?.(pending > 0);
  }, [pending]);

  // si el diálogo se cierra con fotos en vuelo, el formulario tiene que destrabarse
  React.useEffect(() => () => onUploadingRef.current?.(false), []);

  const urls = useSignedUrls(value.map((i) => i.path));
  const room = Math.max(0, max - value.length - pending);

  const upload = React.useCallback(
    async (files: File[]) => {
      const free = Math.max(0, max - valueRef.current.length - pendingRef.current);
      if (free === 0) {
        toast.error(`Ya tenés ${max} fotos. Quitá alguna para subir otra.`);
        return;
      }

      const picked = files.slice(0, free);
      if (files.length > free) {
        toast.error(`Entran ${free} más. Subimos las primeras.`);
      }

      const valid = picked.filter((f) => {
        if (!f.type.startsWith("image/")) {
          toast.error(`"${f.name}" no es una imagen.`);
          return false;
        }
        if (f.size > MAX_BYTES) {
          toast.error(`"${f.name}" pesa más de 8 MB. Sacale una foto más liviana.`);
          return false;
        }
        return true;
      });
      if (valid.length === 0) return;

      bumpPending(valid.length);
      const supabase = createClient();
      const uploaded: ServiceImage[] = [];

      for (const f of valid) {
        const ext = f.name.split(".").pop()?.toLowerCase().replace(/[^a-z0-9]/g, "") || "jpg";
        const path = `${agencyId}/files/${fileId}/${crypto.randomUUID()}.${ext}`;
        const { error } = await supabase.storage
          .from(BUCKET)
          .upload(path, f, { upsert: false, contentType: f.type });
        if (error) {
          toast.error(`No se pudo subir "${f.name}". Probá de nuevo.`);
          continue;
        }
        uploaded.push({ path, name: f.name.slice(0, 120) });
      }

      bumpPending(-valid.length);
      if (uploaded.length > 0) {
        // clamp final: dos tandas rápidas no pueden pasarse del máximo
        onChangeRef.current([...valueRef.current, ...uploaded].slice(0, max));
      }
    },
    [agencyId, fileId, max, bumpPending],
  );

  const remove = (path: string) => {
    // no borramos del storage: el diálogo se puede cancelar y la fila guardada
    // seguiría apuntando a esta imagen. Un blob huérfano es más barato que un roto.
    onChange(value.filter((i) => i.path !== path));
  };

  return (
    <div
      className={cn("space-y-1.5", className)}
      onDragOver={(e) => {
        e.preventDefault();
        if (room > 0) setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
        setDragging(false);
      }}
      onDrop={(e) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) void upload(files);
      }}
    >
      <div className="grid grid-cols-4 gap-2 sm:grid-cols-6">
        {value.map((img) => (
          <div
            key={img.path}
            className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-sand-soft animate-fade-in"
          >
            <Thumb url={urls[img.path]} alt={img.name} className="size-full" />
            <button
              type="button"
              onClick={() => remove(img.path)}
              aria-label={`Quitar ${img.name}`}
              className={cn(
                "absolute right-1 top-1 flex size-9 items-center justify-center rounded-full md:size-7",
                "border border-line bg-paper/90 text-ink-soft shadow-sm backdrop-blur-sm",
                "transition-all hover:text-ink active:scale-90 tap-highlight-none",
                "md:opacity-0 md:group-hover:opacity-100 md:focus-visible:opacity-100",
              )}
            >
              <X className="size-3.5" strokeWidth={2.5} />
            </button>
          </div>
        ))}

        {Array.from({ length: pending }).map((_, i) => (
          <div
            key={`up-${i}`}
            className="flex aspect-square items-center justify-center rounded-xl border border-line bg-sand-soft"
          >
            <Loader2 className="size-4 animate-spin text-ink-faint" />
          </div>
        ))}

        {room > 0 && (
          <button
            type="button"
            onClick={() => inputRef.current?.click()}
            className={cn(
              "flex aspect-square flex-col items-center justify-center gap-1 rounded-xl border border-dashed transition-colors tap-highlight-none active:scale-[0.97]",
              dragging
                ? "border-brand-500 bg-brand-tint text-brand-text"
                : "border-line-strong bg-paper text-ink-faint hover:border-brand-400 hover:bg-sand-soft/60",
            )}
          >
            <ImagePlus className="size-5" strokeWidth={1.8} />
            <span className="text-[10px] font-medium leading-none">Subir</span>
          </button>
        )}
      </div>

      <p className="text-[11px] text-ink-faint">
        Voucher, comprobante o ficha del hotel. Hasta {max} fotos de 8 MB.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (files.length > 0) void upload(files);
        }}
      />
    </div>
  );
}

/* ───────────────────────── tira compacta + lightbox ───────────────────────── */

export function ServiceImagesStrip({
  images,
  className,
}: {
  images: ServiceImage[];
  className?: string;
}) {
  const [openAt, setOpenAt] = React.useState<number | null>(null);
  const shown = images.slice(0, 3);
  const urls = useSignedUrls(shown.map((i) => i.path));

  if (images.length === 0) return null;
  const extra = images.length - shown.length;

  return (
    <>
      <div className={cn("flex items-center gap-1", className)}>
        {shown.map((img, i) => (
          <button
            key={img.path}
            type="button"
            onClick={() => setOpenAt(i)}
            aria-label={`Ver ${img.name}`}
            className="size-11 overflow-hidden rounded-lg border border-line bg-sand-soft transition-all hover:border-line-strong active:scale-95 tap-highlight-none md:size-9"
          >
            <Thumb url={urls[img.path]} alt={img.name} className="size-full" />
          </button>
        ))}
        {extra > 0 && (
          <button
            type="button"
            onClick={() => setOpenAt(shown.length)}
            aria-label={extra === 1 ? "Ver la otra foto" : `Ver las otras ${extra} fotos`}
            className="flex size-11 items-center justify-center rounded-lg border border-line bg-sand-soft text-[11px] font-semibold tabular-nums text-ink-soft transition-colors hover:border-line-strong tap-highlight-none md:size-9"
          >
            +{extra}
          </button>
        )}
      </div>

      {openAt !== null && (
        <ImageLightbox
          images={images}
          index={openAt}
          onIndexChange={setOpenAt}
          onClose={() => setOpenAt(null)}
        />
      )}
    </>
  );
}

function ImageLightbox({
  images,
  index,
  onIndexChange,
  onClose,
}: {
  images: ServiceImage[];
  index: number;
  onIndexChange: (i: number) => void;
  onClose: () => void;
}) {
  const urls = useSignedUrls(images.map((i) => i.path));
  const current = images[index] ?? images[0];
  const many = images.length > 1;

  const go = React.useCallback(
    (delta: number) => onIndexChange((index + delta + images.length) % images.length),
    [index, images.length, onIndexChange],
  );

  React.useEffect(() => {
    if (!many) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") go(1);
      if (e.key === "ArrowLeft") go(-1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, many]);

  const url = urls[current.path];
  // los nombres de archivo de un celular son larguísimos: el título del diálogo no se estira
  const shortName =
    current.name.length > 34 ? `${current.name.slice(0, 32).trimEnd()}…` : current.name;

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        title={shortName || "Foto del servicio"}
        description={many ? `Foto ${index + 1} de ${images.length}` : undefined}
        size="lg"
      >
        <div className="relative flex min-h-[40dvh] items-center justify-center rounded-2xl bg-sand-deep p-2">
          {url === undefined ? (
            <Loader2 className="size-6 animate-spin text-ink-faint" />
          ) : url === null ? (
            <div className="flex flex-col items-center gap-2 py-10 text-ink-faint">
              <ImageOff className="size-6" strokeWidth={1.8} />
              <p className="text-sm">No pudimos abrir esta imagen.</p>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={current.name}
              className="max-h-[62dvh] w-auto max-w-full rounded-xl object-contain animate-fade-in"
            />
          )}

          {many && (
            <>
              <LightboxArrow side="left" onClick={() => go(-1)} />
              <LightboxArrow side="right" onClick={() => go(1)} />
            </>
          )}
        </div>

        {many && (
          <div className="mt-3 flex flex-wrap justify-center gap-1.5">
            {images.map((img, i) => (
              <button
                key={img.path}
                type="button"
                onClick={() => onIndexChange(i)}
                aria-label={`Ver ${img.name}`}
                className={cn(
                  "size-11 overflow-hidden rounded-lg border transition-all tap-highlight-none",
                  i === index
                    ? "border-brand-500 ring-2 ring-brand-500/20"
                    : "border-line opacity-70 hover:opacity-100",
                )}
              >
                <Thumb url={urls[img.path]} alt={img.name} className="size-full" />
              </button>
            ))}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LightboxArrow({ side, onClick }: { side: "left" | "right"; onClick: () => void }) {
  const Icon = side === "left" ? ChevronLeft : ChevronRight;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={side === "left" ? "Anterior" : "Siguiente"}
      className={cn(
        "absolute top-1/2 flex size-11 -translate-y-1/2 items-center justify-center rounded-full",
        "border border-line bg-paper/90 text-ink shadow-sm backdrop-blur-sm",
        "transition-all hover:bg-paper active:scale-90 tap-highlight-none",
        side === "left" ? "left-2" : "right-2",
      )}
    >
      <Icon className="size-5" strokeWidth={2} />
    </button>
  );
}
