"use client";

/**
 * Mandar archivos desde el chat: grabar una nota de voz y adjuntar.
 *
 * ─────────────────────────────────────────────
 * POR QUÉ EL ARCHIVO NO PASA POR LA SERVER ACTION
 *
 * El binario se sube DERECHO al bucket privado desde el navegador y a la action
 * le llega solo el path. La RLS de storage ya encierra al vendedor en la carpeta
 * de su agencia, así que no se pierde nada de seguridad — y se gana poder mandar
 * un PDF de 20 MB, que contra el límite de body de una server action rebota.
 *
 * ─────────────────────────────────────────────
 * EL LÍO DEL FORMATO DE AUDIO (lo más importante de este archivo)
 *
 * Chrome NO graba en ningún contenedor que Meta acepte para una NOTA DE VOZ:
 * `MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')` da false y solo sabe
 * escribir WebM. Y Meta, para que el mensaje llegue con onda y botón de play en
 * vez de un ícono de descarga, exige Ogg/Opus mono.
 *
 * La buena noticia es que el códec YA es Opus en los dos casos: lo único que
 * cambia es el envoltorio. Por eso se graba en WebM y se remuxea a Ogg en el
 * navegador (`lib/audio/webm-to-ogg`), sin decodificar ni volver a codificar:
 * ni pérdida de calidad ni espera.
 *
 * Si el remux no sale, el audio se manda igual como archivo adjunto en vez de
 * como nota de voz. Se escucha lo mismo; pierde la onda. Mejor eso que un error.
 */

import * as React from "react";
import { Mic, Paperclip, Send, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
import { Tooltip } from "@/components/ui/misc";
import { pickRecorderMimeType, webmOpusToOgg } from "@/lib/audio/webm-to-ogg";
import { sendMediaMessage } from "@/lib/actions/messages";
import { cn } from "@/lib/utils";

const BUCKET = "attachments";

/** Techo del lado nuestro. Meta corta antes en casi todos los tipos. */
const MAX_BYTES = 64 * 1024 * 1024;

/** Meta rechaza audios de más de 16 MB; a 32 kbps son ~65 minutos. */
const MAX_RECORDING_MS = 10 * 60 * 1000;

const EXT_BY_MIME: Record<string, string> = {
  "audio/ogg": "ogg",
  "audio/mp4": "m4a",
  "audio/webm": "webm",
  "image/jpeg": "jpg",
  "image/png": "png",
  "application/pdf": "pdf",
};

function extFor(mime: string, name?: string | null): string {
  const base = mime.split(";")[0]!.trim().toLowerCase();
  if (EXT_BY_MIME[base]) return EXT_BY_MIME[base];
  const fromName = name?.includes(".") ? name.split(".").pop() : null;
  return (fromName ?? base.split("/")[1] ?? "bin").replace(/[^a-z0-9]/gi, "").slice(0, 8) || "bin";
}

function mmss(ms: number): string {
  const total = Math.floor(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/* ───────────────────────── subida + envío ───────────────────────── */

type SendInput = {
  agencyId: string;
  conversationId: string;
  blob: Blob;
  mime: string;
  name?: string | null;
  voice?: boolean;
  duration?: number;
};

/**
 * Sube y manda. Devuelve el error para que lo muestre el caller — así el
 * composer decide si además hay que devolver el foco o limpiar algo.
 */
async function uploadAndSend(input: SendInput): Promise<string | null> {
  // La RLS del bucket exige que la primera carpeta sea la agencia, y la action
  // lo vuelve a validar antes de leer el archivo con service role.
  const path = `${input.agencyId}/chat/${input.conversationId}/${crypto.randomUUID()}.${extFor(
    input.mime,
    input.name,
  )}`;

  const { error } = await createClient()
    .storage.from(BUCKET)
    .upload(path, input.blob, { contentType: input.mime, upsert: false });
  if (error) return "No se pudo subir el archivo. Revisá tu conexión.";

  const res = await sendMediaMessage({
    conversationId: input.conversationId,
    path,
    mime: input.mime,
    name: input.name ?? null,
    size: input.blob.size,
    voice: input.voice,
    duration: input.duration,
  });
  return res.ok ? null : res.error;
}

/* ───────────────────────── adjuntar ───────────────────────── */

export function AttachButton({
  agencyId,
  conversationId,
  disabled,
  onSent,
}: {
  agencyId: string;
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);

  async function handlePick(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    // El input se limpia SIEMPRE: si no, elegir el mismo archivo dos veces
    // seguidas no dispara el evento y parece que el botón se rompió.
    e.target.value = "";
    if (!file) return;

    if (file.size > MAX_BYTES) {
      toast.error("Ese archivo es demasiado grande.");
      return;
    }

    setBusy(true);
    const error = await uploadAndSend({
      agencyId,
      conversationId,
      blob: file,
      mime: file.type || "application/octet-stream",
      name: file.name,
    });
    setBusy(false);
    if (error) toast.error(error);
    else onSent?.();
  }

  return (
    <>
      <input
        ref={inputRef}
        type="file"
        onChange={handlePick}
        className="hidden"
        accept="image/*,video/*,audio/*,application/pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt"
      />
      <Tooltip content="Adjuntar un archivo">
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={disabled || busy}
          aria-label="Adjuntar un archivo"
          className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 disabled:opacity-40 tap-highlight-none"
        >
          <Paperclip className={cn("size-5", busy && "animate-pulse")} strokeWidth={1.9} />
        </button>
      </Tooltip>
    </>
  );
}

/* ───────────────────────── nota de voz ───────────────────────── */

export function VoiceRecorder({
  agencyId,
  conversationId,
  disabled,
  onSent,
}: {
  agencyId: string;
  conversationId: string;
  disabled?: boolean;
  onSent?: () => void;
}) {
  const [recording, setRecording] = React.useState(false);
  const [elapsed, setElapsed] = React.useState(0);
  const [sending, setSending] = React.useState(false);

  const recorderRef = React.useRef<MediaRecorder | null>(null);
  const chunksRef = React.useRef<Blob[]>([]);
  const streamRef = React.useRef<MediaStream | null>(null);
  const startedAtRef = React.useRef(0);
  // Cancelar y enviar terminan la misma grabación: la diferencia se decide en el
  // handler de `stop`, y esta bandera es la que se la cuenta.
  const cancelledRef = React.useRef(false);

  const stopTracks = React.useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  // Soltar el micrófono si el componente se va (cambio de chat, cierre del
  // drawer): dejar el track vivo deja el puntito rojo del navegador prendido.
  React.useEffect(() => () => stopTracks(), [stopTracks]);

  /* reloj de la grabación */
  React.useEffect(() => {
    if (!recording) return;
    const t = setInterval(() => {
      const ms = Date.now() - startedAtRef.current;
      setElapsed(ms);
      if (ms >= MAX_RECORDING_MS) recorderRef.current?.stop();
    }, 200);
    return () => clearInterval(t);
  }, [recording]);

  const finish = React.useCallback(
    async (blob: Blob, mimeType: string, duration: number) => {
      setSending(true);

      /* Nota de voz o archivo de audio: lo decide el contenedor. Ogg/Opus mono es
         lo único que Meta acepta como nota de voz; el resto llega igual, pero como
         adjunto. */
      let out = blob;
      let mime = mimeType.split(";")[0]!.trim();
      let voice = mime === "audio/ogg";

      if (mime === "audio/webm") {
        const ogg = webmOpusToOgg(await blob.arrayBuffer());
        if (ogg) {
          out = ogg;
          mime = "audio/ogg";
          voice = true;
        }
        // Si el remux no salió, sigue siendo un audio válido: se manda como
        // adjunto y el cliente lo escucha igual.
      }

      const error = await uploadAndSend({
        agencyId,
        conversationId,
        blob: out,
        mime,
        name: voice ? null : `audio.${extFor(mime)}`,
        voice,
        duration,
      });
      setSending(false);
      if (error) toast.error(error);
      else onSent?.();
    },
    [agencyId, conversationId, onSent],
  );

  const start = React.useCallback(async () => {
    const mimeType = pickRecorderMimeType();
    if (!mimeType) {
      toast.error("Este navegador no puede grabar audio. Probá con Chrome o Firefox.");
      return;
    }

    let stream: MediaStream;
    try {
      // channelCount: 1 no es un detalle — Meta acepta Ogg/Opus "mono input
      // only", y pasar de estéreo a mono después ya no sería un remux.
      stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });
    } catch {
      toast.error("No pudimos usar el micrófono. Revisá los permisos del navegador.");
      return;
    }

    streamRef.current = stream;
    chunksRef.current = [];
    cancelledRef.current = false;

    const recorder = new MediaRecorder(stream, { mimeType });
    recorderRef.current = recorder;
    recorder.ondataavailable = (e) => {
      if (e.data.size > 0) chunksRef.current.push(e.data);
    };
    recorder.onstop = () => {
      const duration = (Date.now() - startedAtRef.current) / 1000;
      const blob = new Blob(chunksRef.current, { type: mimeType });
      stopTracks();
      setRecording(false);
      setElapsed(0);
      if (cancelledRef.current || blob.size === 0) return;
      void finish(blob, mimeType, duration);
    };

    startedAtRef.current = Date.now();
    recorder.start();
    setRecording(true);
    // useCallback y no una función suelta: el linter del compilador de React
    // trata a las funciones del cuerpo del componente como código de render, y
    // ahí `Date.now()` es impuro. Esto es un handler, corre por un click.
  }, [finish, stopTracks]);

  if (recording) {
    return (
      <div className="flex flex-1 items-center gap-2 rounded-lg bg-wa-panel px-2.5 py-1.5">
        <span className="size-2.5 shrink-0 animate-pulse rounded-full bg-red-500" aria-hidden />
        <span className="tabular-nums text-[14px] font-medium text-wa-ink" aria-live="polite">
          {mmss(elapsed)}
        </span>
        <span className="flex-1 text-[12.5px] text-wa-ink-faint">Grabando…</span>
        <Tooltip content="Descartar">
          <button
            type="button"
            onClick={() => {
              cancelledRef.current = true;
              recorderRef.current?.stop();
            }}
            aria-label="Descartar la grabación"
            className="flex size-9 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 tap-highlight-none"
          >
            <Trash2 className="size-4.5" strokeWidth={1.9} />
          </button>
        </Tooltip>
        <Tooltip content="Enviar">
          <button
            type="button"
            onClick={() => recorderRef.current?.stop()}
            aria-label="Enviar la nota de voz"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wa-accent text-white shadow-sm transition-all hover:brightness-110 active:scale-95 tap-highlight-none"
          >
            <Send className="size-4.5 -translate-x-px" />
          </button>
        </Tooltip>
      </div>
    );
  }

  return (
    <Tooltip content="Grabar una nota de voz">
      <button
        type="button"
        onClick={start}
        disabled={disabled || sending}
        aria-label="Grabar una nota de voz"
        className="flex size-11 shrink-0 items-center justify-center rounded-full text-wa-ink-soft transition-colors hover:bg-wa-hover active:scale-95 disabled:opacity-40 tap-highlight-none"
      >
        <Mic className={cn("size-5", sending && "animate-pulse")} strokeWidth={1.9} />
      </button>
    </Tooltip>
  );
}
