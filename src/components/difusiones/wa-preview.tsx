import * as React from "react";
import { CheckCheck, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TemplateButton } from "@/lib/types";

/**
 * La plantilla como la va a ver el cliente en su teléfono.
 *
 * No es decoración: es la única forma de que el usuario entienda qué está por
 * mandarle a 300 personas antes de gastar la plata. Por eso se dibuja con el
 * wallpaper real, la colita de la burbuja y los botones tal cual los pinta
 * WhatsApp — separados por una línea, centrados y en el verde de acento.
 *
 * WhatsApp muestra como mucho tres botones pegados a la burbuja; cuando hay
 * más, los agrupa detrás de "Ver todas las opciones". Se replica igual para no
 * prometer una pantalla que el cliente no va a ver.
 */
const MAX_BOTONES_VISIBLES = 3;

export function WaPreview({
  header,
  body,
  footer,
  buttons = [],
  vars,
  time = "11:42",
  className,
}: {
  header?: string | null;
  body: string;
  footer?: string | null;
  buttons?: TemplateButton[];
  /** valores con los que se reemplazan las {{variables}} del texto */
  vars: Record<string, string>;
  time?: string;
  className?: string;
}) {
  const visibles = buttons.slice(0, MAX_BOTONES_VISIBLES);
  const ocultos = buttons.length - visibles.length;

  return (
    <div className={cn("wa-wallpaper overflow-hidden rounded-2xl p-3 pl-6", className)}>
      <div className="relative ml-auto mr-2 w-fit min-w-[15rem] max-w-[calc(100%-0.5rem)] rounded-lg rounded-tr-none bg-wa-bubble-out shadow-sm bubble-tail-out">
        <div className="px-2.5 pb-1.5 pt-1.5">
          {header?.trim() ? (
            <p className="mb-1 text-[13.5px] font-semibold leading-snug text-wa-bubble-ink">
              <VarText text={header} vars={vars} />
            </p>
          ) : null}

          <p className="whitespace-pre-wrap text-[13.5px] leading-relaxed text-wa-bubble-ink">
            <VarText text={body} vars={vars} />
          </p>

          {footer?.trim() ? (
            <p className="mt-1.5 whitespace-pre-wrap text-[11.5px] leading-snug text-wa-bubble-meta">
              <VarText text={footer} vars={vars} />
            </p>
          ) : null}

          <span className="mt-0.5 flex items-center justify-end gap-1 text-[10px] leading-none text-wa-bubble-meta">
            {time}
            <CheckCheck className="size-3.5 text-wa-tick" strokeWidth={2} />
          </span>
        </div>

        {visibles.length > 0 && (
          <div>
            {visibles.map((b, i) => (
              <div
                key={`${b.text}-${i}`}
                className="flex h-9 items-center justify-center gap-1.5 border-t border-wa-bubble-ink/10 px-2 text-[13.5px] font-medium text-wa-accent last:rounded-b-lg"
              >
                {b.type === "url" && <ExternalLink className="size-3.5 shrink-0" strokeWidth={2} />}
                <span className="truncate">{b.text}</span>
              </div>
            ))}
            {ocultos > 0 && (
              <div className="flex h-9 items-center justify-center rounded-b-lg border-t border-wa-bubble-ink/10 px-2 text-[13.5px] font-medium text-wa-accent">
                Ver todas las opciones
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * Texto con las {{variables}} reemplazadas. La que no tiene valor queda a la
 * vista como token: Meta rechaza el envío si una variable llega vacía, así que
 * es mejor que se vea acá y no en el error del disparo.
 */
function VarText({ text, vars }: { text: string; vars: Record<string, string> }) {
  const parts = text.split(/(\{\{\w+\}\})/g);
  return (
    <>
      {parts.map((p, i) => {
        const m = /^\{\{(\w+)\}\}$/.exec(p);
        if (!m) return <React.Fragment key={i}>{p}</React.Fragment>;
        const valor = vars[m[1]];
        if (valor) return <React.Fragment key={i}>{valor}</React.Fragment>;
        return (
          <code
            key={i}
            className="mx-px rounded-md bg-wa-accent/20 px-1 py-0.5 font-mono text-[11.5px] font-semibold"
          >
            {p}
          </code>
        );
      })}
    </>
  );
}
