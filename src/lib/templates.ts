import type { TemplateButton } from "@/lib/types";

/**
 * `wa_templates.buttons` y `broadcasts.buttons_snapshot` son jsonb: nunca
 * confiar en su forma al leerlos.
 *
 * Vive acá y no en `template-dialog.tsx` por una razón concreta: ese archivo
 * arranca con `"use client"`, y en React Server Components TODOS los exports de
 * un módulo cliente se reemplazan por referencias. Un componente se puede
 * renderizar desde el server; una función pura NO se puede llamar — tira
 * "Attempted to call parseTemplateButtons() from the server". Eso es lo que
 * hacía que `/difusiones/[id]` diera 500 apenas existió la primera difusión de
 * verdad (antes cortaba en `notFound()` y nunca llegaba a la llamada).
 */
export function parseTemplateButtons(value: unknown): TemplateButton[] {
  if (!Array.isArray(value)) return [];
  const out: TemplateButton[] = [];
  for (const raw of value) {
    if (!raw || typeof raw !== "object") continue;
    const b = raw as Record<string, unknown>;
    const type = b.type === "url" ? "url" : "quick_reply";
    const text = typeof b.text === "string" ? b.text : "";
    if (!text) continue;
    out.push({
      type,
      text,
      url: type === "url" && typeof b.url === "string" ? b.url : null,
      intent:
        type === "quick_reply" && (b.intent === "interesado" || b.intent === "tal_vez" || b.intent === "baja")
          ? b.intent
          : null,
    });
  }
  return out;
}
