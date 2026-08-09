"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Mic, Pause, Play } from "lucide-react";
import { cn } from "@/lib/utils";

/** Cantidad de barras de la onda. 40 es lo que usa WhatsApp Web y entra en la burbuja más angosta. */
const BAR_COUNT = 40;

/** Altura de las barras mientras no sabemos los picos (o si el decode falló). */
const FLAT_PEAK = 0.34;

/** Piso de altura: un silencio tiene que verse como una rayita, no como nada. */
const MIN_PEAK = 0.14;

/** Onda neutra compartida: misma referencia en todas las burbujas que todavía no decodificaron. */
const FLAT_SHAPE: readonly number[] = new Array<number>(BAR_COUNT).fill(FLAT_PEAK);

/**
 * Arriba de esto no decodificamos: un mp3 largo en 200 burbujas congela la pestaña.
 * La nota de voz de WhatsApp pesa unos pocos cientos de KB; el que se pase suena
 * igual, solo que con barras parejas.
 */
const MAX_DECODE_BYTES = 8 * 1024 * 1024;

const SPEEDS = [
  { value: 1, label: "1x" },
  { value: 1.5, label: "1,5x" },
  { value: 2, label: "2x" },
] as const;

type AudioContextCtor = new (options?: AudioContextOptions) => AudioContext;

/**
 * Un solo AudioContext para todo el módulo: el navegador permite un puñado por
 * pestaña y un hilo con muchos audios crearía uno por burbuja. Se instancia
 * perezosamente, recién cuando hay que decodificar algo.
 */
let sharedCtx: AudioContext | null = null;

function getSharedContext(): AudioContext | null {
  if (typeof window === "undefined") return null;
  if (sharedCtx) return sharedCtx;
  const legacy = window as Window & { webkitAudioContext?: AudioContextCtor };
  const Ctor: AudioContextCtor | undefined = window.AudioContext ?? legacy.webkitAudioContext;
  if (!Ctor) return null;
  try {
    sharedCtx = new Ctor();
  } catch {
    return null;
  }
  return sharedCtx;
}

type Waveform = { key: string; peaks: number[]; duration: number };

const PEAKS_CACHE = new Map<string, Waveform>();
const PEAKS_CACHE_MAX = 80;

/** La URL viene firmada: la query cambia en cada pedido, pero el archivo es el mismo. */
function cacheKey(src: string): string {
  const q = src.indexOf("?");
  return q === -1 ? src : src.slice(0, q);
}

function rememberWaveform(value: Waveform): void {
  PEAKS_CACHE.set(value.key, value);
  if (PEAKS_CACHE.size > PEAKS_CACHE_MAX) {
    const oldest = PEAKS_CACHE.keys().next().value;
    if (oldest !== undefined) PEAKS_CACHE.delete(oldest);
  }
}

/** Promedia el primer canal en `count` bloques y normaliza para que una nota bajita se vea igual de viva. */
function extractPeaks(buffer: AudioBuffer, count: number): number[] {
  const channel = buffer.getChannelData(0);
  const block = Math.max(1, Math.floor(channel.length / count));
  const peaks: number[] = [];
  let max = 0;
  for (let i = 0; i < count; i++) {
    const start = i * block;
    const end = Math.min(start + block, channel.length);
    let sum = 0;
    for (let j = start; j < end; j++) sum += Math.abs(channel[j]);
    const avg = end > start ? sum / (end - start) : 0;
    peaks.push(avg);
    if (avg > max) max = avg;
  }
  if (max <= 0) return peaks.map(() => FLAT_PEAK);
  return peaks.map((p) => Math.min(1, p / max));
}

function fmtClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  const total = Math.floor(safe);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

function clamp(n: number, min: number, max: number): number {
  return n < min ? min : n > max ? max : n;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void): () => void {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}

function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false, // en el servidor no hay media queries; el cliente corrige al hidratar
  );
}

export function AudioPlayer({
  src,
  out,
  voice = false,
  durationHint = null,
  className,
}: {
  /** URL firmada del audio. null = todavía se está pidiendo. */
  src: string | null;
  /** burbuja saliente: cambia los colores sobre el fondo verde */
  out: boolean;
  /** true = nota de voz grabada (micrófono); false = archivo de audio */
  voice?: boolean;
  /** duración en segundos si ya la sabemos (evita esperar la metadata) */
  durationHint?: number | null;
  className?: string;
}): ReactElement {
  const reduced = usePrefersReducedMotion();

  const [decoded, setDecoded] = useState<Waveform | null>(null);
  const [metaDuration, setMetaDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [started, setStarted] = useState(false);
  const [speedIdx, setSpeedIdx] = useState(0);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const trackRef = useRef<HTMLDivElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const draggingRef = useRef(false);
  // el efecto del audio solo depende de src: si leyera estos valores del render,
  // cambiar la velocidad recrearía el elemento y cortaría la reproducción
  const reducedRef = useRef(reduced);
  const rateRef = useRef(1);

  useEffect(() => {
    reducedRef.current = reduced;
  }, [reduced]);

  const speed = SPEEDS[speedIdx] ?? SPEEDS[0];

  // la onda vale para la URL que la generó: si la burbuja cambia de audio, el estado
  // viejo deja de aplicar solo, sin resetearlo desde un efecto
  const activeKey = src ? cacheKey(src) : null;
  const wave =
    activeKey === null
      ? null
      : decoded?.key === activeKey
        ? decoded
        : (PEAKS_CACHE.get(activeKey) ?? null);
  const peaks = wave?.peaks ?? null;
  const decodedDuration = wave?.duration ?? 0;

  /* Onda real: bajar, decodificar y promediar. Si algo falla quedan barras parejas. */
  useEffect(() => {
    if (!src) return;
    const key = cacheKey(src);
    if (PEAKS_CACHE.has(key)) return; // ya está: el render la lee del cache

    let alive = true;
    const ctrl = new AbortController();

    void (async () => {
      try {
        const res = await fetch(src, { signal: ctrl.signal });
        if (!res.ok) return;
        const raw = await res.arrayBuffer();
        if (!alive || raw.byteLength === 0 || raw.byteLength > MAX_DECODE_BYTES) return;
        const ctx = getSharedContext();
        if (!ctx) return;
        const buffer = await ctx.decodeAudioData(raw);
        const waveform: Waveform = {
          key,
          peaks: extractPeaks(buffer, BAR_COUNT),
          duration: buffer.duration,
        };
        rememberWaveform(waveform);
        if (!alive) return;
        setDecoded(waveform);
      } catch {
        // degradar, nunca romper: el <audio> nativo sigue siendo la fuente de verdad
        // y la burbuja muestra barras neutras en vez de reventar el hilo
      }
    })();

    return () => {
      alive = false;
      ctrl.abort();
    };
  }, [src]);

  /* Elemento de audio + listeners + ticker de progreso. Todo se desarma en el cleanup. */
  useEffect(() => {
    if (!src) return;

    const el = new Audio();
    el.preload = "metadata";
    el.playbackRate = rateRef.current;
    el.src = src;
    audioRef.current = el;

    const stopTicker = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    const tick = () => {
      const a = audioRef.current;
      if (!a) return;
      setCurrentTime(a.currentTime);
      rafRef.current = requestAnimationFrame(tick);
    };
    const startTicker = () => {
      // con movimiento reducido alcanza timeupdate (4 refrescos por segundo): sin animación
      if (reducedRef.current) return;
      stopTicker();
      rafRef.current = requestAnimationFrame(tick);
    };

    const onLoadedMeta = () => {
      if (Number.isFinite(el.duration) && el.duration > 0) setMetaDuration(el.duration);
    };
    const onTimeUpdate = () => setCurrentTime(el.currentTime);
    const onPlay = () => {
      setPlaying(true);
      setStarted(true);
      startTicker();
    };
    const onPause = () => {
      setPlaying(false);
      stopTicker();
      setCurrentTime(el.currentTime);
    };
    const onEnded = () => {
      setPlaying(false);
      stopTicker();
      setCurrentTime(0);
      el.currentTime = 0;
      // `started` no se resetea: el botón de velocidad ya apareció y sacarlo saltaría la fila
    };
    const onError = () => {
      setPlaying(false);
      stopTicker();
    };

    el.addEventListener("loadedmetadata", onLoadedMeta);
    el.addEventListener("durationchange", onLoadedMeta);
    el.addEventListener("timeupdate", onTimeUpdate);
    el.addEventListener("play", onPlay);
    el.addEventListener("pause", onPause);
    el.addEventListener("ended", onEnded);
    el.addEventListener("error", onError);

    return () => {
      stopTicker();
      el.removeEventListener("loadedmetadata", onLoadedMeta);
      el.removeEventListener("durationchange", onLoadedMeta);
      el.removeEventListener("timeupdate", onTimeUpdate);
      el.removeEventListener("play", onPlay);
      el.removeEventListener("pause", onPause);
      el.removeEventListener("ended", onEnded);
      el.removeEventListener("error", onError);
      el.pause();
      el.removeAttribute("src");
      el.load(); // corta la descarga en curso; sin esto el buffer sigue vivo
      if (audioRef.current === el) audioRef.current = null;
      setPlaying(false);
      setStarted(false);
      setCurrentTime(0);
    };
  }, [src]);

  useEffect(() => {
    rateRef.current = speed.value;
    if (audioRef.current) audioRef.current.playbackRate = speed.value;
  }, [speed.value, src]);

  const duration =
    durationHint && durationHint > 0 ? durationHint : decodedDuration > 0 ? decodedDuration : metaDuration;

  const toggle = useCallback(() => {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      void el.play().catch(() => setPlaying(false));
    } else {
      el.pause();
    }
  }, []);

  const seekToRatio = useCallback(
    (ratio: number) => {
      const el = audioRef.current;
      if (!el || duration <= 0) return;
      const t = clamp(ratio, 0, 1) * duration;
      try {
        el.currentTime = t;
      } catch {
        // algunos ogg de WhatsApp no traen índice: si el navegador no puede saltar,
        // al menos movemos la onda para que el gesto no se sienta muerto
      }
      setCurrentTime(t);
      setStarted(true);
    },
    [duration],
  );

  const seekToClientX = useCallback(
    (clientX: number) => {
      const track = trackRef.current;
      if (!track) return;
      const rect = track.getBoundingClientRect();
      if (rect.width <= 0) return;
      seekToRatio((clientX - rect.left) / rect.width);
    },
    [seekToRatio],
  );

  const disabled = !src;
  const shape = peaks ?? FLAT_SHAPE;
  const progress = duration > 0 ? clamp(currentTime / duration, 0, 1) : 0;
  const playedBars = Math.round(progress * BAR_COUNT);
  // sin arrancar (o al terminar, que vuelve a cero) mostramos la duración total, como WhatsApp
  const timeLabel = fmtClock(currentTime > 0 || playing ? currentTime : duration);

  const bars = useMemo(
    () =>
      shape.map((p, i) => (
        <span
          key={i}
          className={cn(
            "min-w-[2px] flex-1 rounded-full",
            i < playedBars ? "bg-wa-accent-deep" : out ? "bg-wa-bubble-ink/30" : "bg-wa-bubble-ink/20",
            !reduced && "transition-[height,background-color] duration-150 ease-out",
          )}
          style={{ height: `${Math.max(MIN_PEAK, p) * 100}%` }}
        />
      )),
    [shape, playedBars, out, reduced],
  );

  return (
    <div className={cn("flex w-full min-w-0 items-center gap-2.5 py-0.5", className)}>
      <button
        type="button"
        onClick={toggle}
        disabled={disabled}
        aria-label={playing ? "Pausar" : "Reproducir"}
        className={cn(
          "grid size-9 shrink-0 place-items-center rounded-full transition-colors",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-accent-deep",
          out ? "bg-wa-panel text-wa-accent-deep" : "bg-wa-accent-deep text-white",
          disabled ? "opacity-50" : "active:scale-[0.96]",
        )}
      >
        {playing ? (
          <Pause className="size-4 fill-current" strokeWidth={1.75} />
        ) : (
          <Play className="size-4 translate-x-[1px] fill-current" strokeWidth={1.75} />
        )}
      </button>

      <div className="min-w-0 flex-1">
        <div
          ref={trackRef}
          role="slider"
          aria-label="Progreso del audio"
          aria-valuemin={0}
          aria-valuemax={Math.max(1, Math.round(duration))}
          aria-valuenow={Math.round(currentTime)}
          aria-valuetext={`${fmtClock(currentTime)} de ${fmtClock(duration)}`}
          aria-disabled={disabled || undefined}
          tabIndex={disabled ? -1 : 0}
          onPointerDown={
            disabled
              ? undefined
              : (e) => {
                  if (e.pointerType === "mouse" && e.button !== 0) return;
                  draggingRef.current = true;
                  trackRef.current?.setPointerCapture(e.pointerId);
                  seekToClientX(e.clientX);
                }
          }
          onPointerMove={
            disabled
              ? undefined
              : (e) => {
                  if (draggingRef.current) seekToClientX(e.clientX);
                }
          }
          onPointerUp={
            disabled
              ? undefined
              : (e) => {
                  draggingRef.current = false;
                  if (trackRef.current?.hasPointerCapture(e.pointerId)) {
                    trackRef.current.releasePointerCapture(e.pointerId);
                  }
                }
          }
          onPointerCancel={
            disabled
              ? undefined
              : () => {
                  draggingRef.current = false;
                }
          }
          onKeyDown={
            disabled
              ? undefined
              : (e) => {
                  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
                    e.preventDefault();
                    const step = e.key === "ArrowRight" ? 5 : -5;
                    if (duration > 0) seekToRatio((currentTime + step) / duration);
                  } else if (e.key === "Home") {
                    e.preventDefault();
                    seekToRatio(0);
                  } else if (e.key === "End") {
                    e.preventDefault();
                    seekToRatio(1);
                  } else if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    toggle();
                  }
                }
          }
          className={cn(
            "flex h-7 w-full touch-pan-y items-center gap-[2px] rounded-sm",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-accent-deep",
            disabled ? "opacity-60" : "cursor-pointer",
          )}
        >
          {bars}
        </div>

        <div className="mt-1 flex items-center justify-between gap-2">
          {started && !disabled ? (
            <button
              type="button"
              onClick={() => setSpeedIdx((i) => (i + 1) % SPEEDS.length)}
              aria-label={`Velocidad de reproducción ${speed.label}`}
              className={cn(
                "rounded-full px-1.5 py-[1px] text-[10px] font-semibold leading-4 tabular-nums transition-colors",
                "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-wa-accent-deep",
                "bg-wa-ink/10 text-wa-bubble-meta hover:bg-wa-ink/15",
              )}
            >
              {speed.label}
            </button>
          ) : (
            <span className="h-4" />
          )}

          <span className="flex shrink-0 items-center gap-1 text-[11px] leading-none text-wa-bubble-meta">
            {voice && <Mic className="size-3 shrink-0" strokeWidth={2} />}
            <span className="tabular-nums">{timeLabel}</span>
          </span>
        </div>
      </div>
    </div>
  );
}
