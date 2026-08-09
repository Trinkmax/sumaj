"use client";

/**
 * Lo que se ve dentro de una burbuja cuando el mensaje trae un archivo.
 *
 * Los adjuntos viven en el bucket PRIVADO `attachments` (el webhook los baja de
 * Meta antes de que la URL venza, ver lib/media/store.ts). Acá se piden URLs
 * firmadas de una hora, on demand y cacheadas por path — mismo patrón que las
 * imágenes de los servicios de un file.
 *
 * Cada tipo se muestra como lo muestra WhatsApp, que es lo que el vendedor
 * espera: la foto se ve, la figurita flota sin fondo, el audio se escucha ahí
 * mismo y el documento se baja.
 */

import * as React from "react";
import { Download, FileText, ImageOff, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { AudioPlayer } from "./audio-player";
import type { MessageMedia } from "@/lib/types";
import { cn } from "@/lib/utils";

const BUCKET = "attachments";
const SIGNED_TTL = 3600;

/* ───────────────────────── URLs firmadas ───────────────────────── */

const urlCache = new Map<string, { url: string; expiresAt: number }>();

async function signUrl(path: string): Promise<string | null> {
  const hit = urlCache.get(path);
  if (hit && hit.expiresAt > Date.now()) return hit.url;
  const { data, error } = await createClient()
    .storage.from(BUCKET)
    .createSignedUrl(path, SIGNED_TTL);
  if (error || !data?.signedUrl) return null;
  // Un minuto de margen: un link que vence mientras carga la imagen se ve igual
  // que un archivo roto.
  urlCache.set(path, { url: data.signedUrl, expiresAt: Date.now() + (SIGNED_TTL - 60) * 1000 });
  return data.signedUrl;
}

/** `undefined` = pidiendo · `null` = no se pudo · string = lista. */
function useSignedUrl(path: string | null): string | null | undefined {
  const [url, setUrl] = React.useState<string | null | undefined>(undefined);

  React.useEffect(() => {
    if (!path) return;
    let alive = true;
    void signUrl(path).then((u) => {
      if (alive) setUrl(u);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  return path ? url : null;
}

/* ───────────────────────── piezas ───────────────────────── */

function humanSize(bytes: number | null | undefined): string | null {
  if (!bytes) return null;
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} kB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Marco de carga y de error, con la proporción de una foto de celular. */
function MediaFrame({
  children,
  className,
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[140px] w-[240px] items-center justify-center rounded-md bg-wa-ink/5",
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ───────────────────────── el contenido ───────────────────────── */

export function MediaContent({
  media,
  out,
  caption,
}: {
  media: MessageMedia;
  out: boolean;
  /** el texto del mensaje, que en un adjunto es el pie de foto */
  caption?: string | null;
}) {
  const url = useSignedUrl(media.path);
  const [zoom, setZoom] = React.useState(false);
  const type = media.mime.split("/")[0];

  /* Figurita: va sin fondo de burbuja y sin marco, flotando sobre el wallpaper —
     si se dibujara adentro de la burbuja verde dejaría de parecer una figurita. */
  if (media.sticker) {
    return (
      <div className="py-0.5">
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={url}
            alt="Figurita"
            className="size-[120px] object-contain"
            loading="lazy"
          />
        ) : (
          <div className="flex size-[120px] items-center justify-center">
            {url === null ? (
              <ImageOff className="size-6 text-wa-ink-faint" />
            ) : (
              <Loader2 className="size-5 animate-spin text-wa-ink-faint" />
            )}
          </div>
        )}
      </div>
    );
  }

  if (type === "audio") {
    return (
      <AudioPlayer
        src={url ?? null}
        out={out}
        voice={media.voice}
        durationHint={media.duration ?? null}
        className="my-0.5"
      />
    );
  }

  if (type === "image") {
    return (
      <>
        <button
          type="button"
          onClick={() => url && setZoom(true)}
          className="block overflow-hidden rounded-md tap-highlight-none"
          aria-label="Ver la imagen en grande"
        >
          {url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={url}
              alt={caption ?? "Imagen"}
              className="max-h-[320px] w-[240px] rounded-md object-cover transition-transform hover:scale-[1.01]"
              loading="lazy"
            />
          ) : (
            <MediaFrame>
              {url === null ? (
                <ImageOff className="size-6 text-wa-ink-faint" />
              ) : (
                <Loader2 className="size-5 animate-spin text-wa-ink-faint" />
              )}
            </MediaFrame>
          )}
        </button>

        <Dialog open={zoom} onOpenChange={setZoom}>
          <DialogContent title={caption ?? "Imagen"} size="xl">
            {url && (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={url} alt={caption ?? "Imagen"} className="max-h-[75vh] w-full object-contain" />
            )}
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (type === "video") {
    return url ? (
      <video
        src={url}
        controls
        preload="metadata"
        className="max-h-[320px] w-[240px] rounded-md bg-black"
      />
    ) : (
      <MediaFrame>
        {url === null ? (
          <ImageOff className="size-6 text-wa-ink-faint" />
        ) : (
          <Loader2 className="size-5 animate-spin text-wa-ink-faint" />
        )}
      </MediaFrame>
    );
  }

  /* Documento: nombre, peso y descarga. Nada de previsualizar un PDF adentro de
     una burbuja de 240 px. */
  const size = humanSize(media.size);
  return (
    <a
      href={url ?? undefined}
      download={media.name ?? undefined}
      target="_blank"
      rel="noopener noreferrer"
      className={cn(
        "my-0.5 flex w-[240px] items-center gap-2.5 rounded-md bg-wa-ink/5 px-2.5 py-2 transition-colors",
        url ? "hover:bg-wa-ink/10" : "pointer-events-none opacity-70",
      )}
    >
      <FileText className="size-5 shrink-0 text-wa-ink-soft" strokeWidth={1.9} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] leading-snug text-wa-bubble-ink">
          {media.name ?? "Documento"}
        </span>
        {size && <span className="block text-[11px] text-wa-bubble-meta">{size}</span>}
      </span>
      {url === undefined ? (
        <Loader2 className="size-4 shrink-0 animate-spin text-wa-ink-faint" />
      ) : (
        <Download className="size-4 shrink-0 text-wa-ink-soft" />
      )}
    </a>
  );
}

/* ───────────────────────── reacciones ───────────────────────── */

/**
 * El chip de reacciones, colgado del borde de abajo de la burbuja.
 *
 * Se monta con margen negativo para que se superponga apenas, como en WhatsApp:
 * la reacción pertenece al mensaje, no es una fila aparte.
 */
export function Reactions({ emojis, out }: { emojis: string[]; out: boolean }) {
  if (emojis.length === 0) return null;
  return (
    <div
      className={cn(
        "-mt-2 flex w-fit items-center gap-0.5 rounded-full bg-wa-panel-alt px-1.5 py-0.5 shadow-[0_1px_0.5px_rgba(11,20,26,0.13)]",
        out ? "ml-auto mr-1" : "ml-1",
      )}
    >
      {emojis.map((e, i) => (
        <span key={`${e}-${i}`} className="text-[13px] leading-none">
          {e}
        </span>
      ))}
    </div>
  );
}
