/**
 * Los archivos que mandan los clientes: cómo entran y dónde quedan.
 *
 * SOLO SERVIDOR y con service role: lo llaman los webhooks, que no tienen sesión.
 *
 * ─────────────────────────────────────────────
 * POR QUÉ HAY QUE BAJARLOS SÍ O SÍ, Y EN EL MOMENTO
 *
 * Meta NO manda el archivo en el webhook: manda un id y una URL que **vive cinco
 * minutos**, y que además hay que pedir con el token (un GET pelado devuelve
 * 401). El id entrante caduca a los 7 días. Instagram es parecido: la URL viene
 * firmada y vence a los pocos días.
 *
 * O sea: guardar la URL es guardar un link roto. Si el archivo no se baja
 * mientras entra el mensaje, se pierde. Y lo que se pierde es la foto del
 * pasaporte que el cliente mandó para emitir, o el audio donde dice las fechas
 * del viaje.
 *
 * Por eso el webhook baja el binario y lo sube al bucket privado `attachments`,
 * el mismo donde ya viven los vouchers de los files. En `messages.media` queda el
 * PATH, nunca una URL: las firmadas duran una hora y se piden al mostrar.
 *
 * ─────────────────────────────────────────────
 * QUÉ PASA SI FALLA
 *
 * Nada que pierda el mensaje. Si el archivo no se pudo bajar, el mensaje se
 * guarda igual —con su texto, su remitente y su hora— y en el hilo aparece como
 * un adjunto que no se pudo recuperar. Perder el archivo es malo; perder también
 * la consulta del cliente sería peor.
 */
import { createAdminClient } from "@/lib/supabase/admin";
import type { MessageMedia } from "@/lib/types";

const BUCKET = "attachments";

/** Techo duro. Meta ya limita por tipo (5 MB imagen, 16 MB audio/video, 100 MB doc). */
const MAX_BYTES = 100 * 1024 * 1024;

/**
 * El tipo vive en `lib/types.ts` porque también lo necesita la burbuja, y este
 * módulo importa el cliente con service role: un client component no puede
 * importar de acá ni siquiera un tipo.
 */
export type { MessageMedia };

export type StoreResult =
  | { ok: true; media: MessageMedia }
  | { ok: false; error: string };

/**
 * Extensión a partir del MIME. El nombre del archivo en el bucket no lo ve
 * nadie, pero la extensión sí importa: es de lo que se agarra el navegador (y
 * Meta, cuando lo devolvemos) para saber qué es.
 */
const EXT_BY_MIME: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "video/mp4": "mp4",
  "video/3gpp": "3gp",
  "audio/ogg": "ogg",
  "audio/mpeg": "mp3",
  "audio/mp4": "m4a",
  "audio/aac": "aac",
  "audio/amr": "amr",
  "application/pdf": "pdf",
  "text/plain": "txt",
};

/**
 * El MIME de Meta puede venir con parámetros: "audio/ogg; codecs=opus". Para
 * comparar contra una tabla hay que quedarse con el tipo pelado — es una de las
 * trampas que la documentación marca explícitamente.
 */
export function baseMime(mime: string | null | undefined): string {
  return (mime ?? "").split(";")[0]!.trim().toLowerCase();
}

function extFor(mime: string, name?: string | null): string {
  const known = EXT_BY_MIME[baseMime(mime)];
  if (known) return known;
  const fromName = name?.includes(".") ? name.split(".").pop() : null;
  return (fromName ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

/**
 * Baja un archivo de un tercero y lo deja en el bucket propio.
 *
 * @param token Si viene, va como `Authorization: Bearer`. Meta lo exige para
 *   descargar: sin él la URL devuelve 401 aunque sea la que ella misma mandó.
 */
export async function storeRemoteMedia(input: {
  agencyId: string;
  conversationId: string;
  url: string;
  token?: string | null;
  mime?: string | null;
  name?: string | null;
  extra?: Omit<MessageMedia, "path" | "mime" | "name" | "size">;
}): Promise<StoreResult> {
  let response: Response;
  try {
    response = await fetch(input.url, {
      headers: input.token ? { Authorization: `Bearer ${input.token}` } : {},
      cache: "no-store",
      // El webhook tiene que contestarle a Meta rápido: un archivo que tarda más
      // que esto se abandona y el mensaje entra igual, sin adjunto.
      signal: AbortSignal.timeout(20_000),
    });
  } catch (e) {
    const aborted = e instanceof Error && e.name === "TimeoutError";
    return {
      ok: false,
      error: aborted ? "El archivo tardó demasiado en bajar." : "No se pudo bajar el archivo.",
    };
  }

  if (!response.ok) {
    return { ok: false, error: `El archivo no se pudo bajar (${response.status}).` };
  }

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) return { ok: false, error: "El archivo vino vacío." };
  if (buffer.byteLength > MAX_BYTES) return { ok: false, error: "El archivo es demasiado grande." };

  const mime = baseMime(input.mime ?? response.headers.get("content-type")) || "application/octet-stream";

  return await putMedia({
    agencyId: input.agencyId,
    conversationId: input.conversationId,
    body: buffer,
    mime,
    name: input.name,
    extra: input.extra,
  });
}

/** Sube un binario que ya tenemos en memoria (lo que graba o adjunta el vendedor). */
export async function putMedia(input: {
  agencyId: string;
  conversationId: string;
  body: ArrayBuffer | Blob;
  mime: string;
  name?: string | null;
  extra?: Omit<MessageMedia, "path" | "mime" | "name" | "size">;
}): Promise<StoreResult> {
  const mime = baseMime(input.mime) || "application/octet-stream";
  // La RLS del bucket exige que la primera carpeta sea la agencia; el resto es
  // para poder encontrar las cosas a mano el día que haya que mirar.
  const path = `${input.agencyId}/chat/${input.conversationId}/${crypto.randomUUID()}.${extFor(mime, input.name)}`;

  const { error } = await createAdminClient()
    .storage.from(BUCKET)
    .upload(path, input.body, { contentType: mime, upsert: false });

  if (error) return { ok: false, error: "No se pudo guardar el archivo." };

  const size = input.body instanceof Blob ? input.body.size : input.body.byteLength;
  return {
    ok: true,
    media: { path, mime, name: input.name ?? null, size, ...input.extra },
  };
}

/**
 * Baja de nuestro propio bucket. Lo usa el envío: el archivo ya está guardado y
 * hay que pasárselo a Meta.
 */
export async function readMedia(path: string): Promise<ArrayBuffer | null> {
  const { data, error } = await createAdminClient().storage.from(BUCKET).download(path);
  if (error || !data) return null;
  return await data.arrayBuffer();
}
