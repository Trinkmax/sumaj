"use client";

import * as React from "react";
import {
  Ban,
  ChevronDown,
  PhoneOff,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  TriangleAlert,
  UsersRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input, Label, Select } from "@/components/ui/input";
import { AnimatedNumber, ChoiceGrid, Segmented, Skeleton, Switch } from "@/components/ui/misc";
import { STAGES, TAG_DOTS } from "@/lib/domain";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { BroadcastAudience, LeadStage } from "@/lib/types";
import {
  AUDIENCE_PRESETS,
  describeAudience,
  type AudienceRow,
} from "@/lib/broadcasts/audience";

export type PickerTag = { id: string; name: string; color: string; category: string };
export type PickerBranch = { id: string; name: string };
export type PickerMember = { id: string; display_name: string };

/** Lo que se sabe de la agenda entera, para explicar quién NO entra nunca. */
export type ContactStats = {
  total: number;
  sinTelefono: number;
  bajas: number;
};

const MESES = [
  "enero",
  "febrero",
  "marzo",
  "abril",
  "mayo",
  "junio",
  "julio",
  "agosto",
  "septiembre",
  "octubre",
  "noviembre",
  "diciembre",
];

/* Los umbrales van cortos a propósito: en 390px cuatro segmentos entran
   cómodos y el sentido completo lo da la etiqueta de arriba. */
const SILENCIO_OPCIONES = [
  { value: "", label: "Da igual" },
  { value: "60", label: "60 d" },
  { value: "90", label: "90 d" },
  { value: "180", label: "180 d" },
];

const REPETIR_OPCIONES = [
  { value: "0", label: "Sin freno" },
  { value: "7", label: "7 d" },
  { value: "15", label: "15 d" },
  { value: "30", label: "30 d" },
];

/**
 * El bloque "a quiénes les llega".
 *
 * El protagonista no son los filtros: es el número y las caras. La gente no
 * aprieta enviar sobre un total abstracto, aprieta cuando reconoce nombres. Por
 * eso los presets están arriba (un toque y listo), los filtros finos quedan
 * plegados, y abajo de todo vive el contador en vivo con la muestra real.
 *
 * El componente no consulta nada: el composer es el dueño del `previewAudience`
 * y le pasa el resultado ya debounceado. Así el contador de la barra pegajosa y
 * el de acá nunca dicen números distintos.
 */
export function AudiencePicker({
  audience,
  presetKey,
  onPreset,
  onFilters,
  onCare,
  tags,
  branches,
  members,
  total,
  sample,
  loading,
  error,
  onRetry,
  protectedCount,
  stats,
}: {
  audience: BroadcastAudience;
  presetKey: string | null;
  onPreset: (key: string) => void;
  /** cambia un filtro de audiencia (deja de ser un preset) */
  onFilters: (patch: Partial<BroadcastAudience>) => void;
  /** cambia una protección; no toca el preset elegido */
  onCare: (patch: Partial<BroadcastAudience>) => void;
  tags: PickerTag[];
  branches: PickerBranch[];
  members: PickerMember[];
  /** null = todavía no se midió */
  total: number | null;
  sample: AudienceRow[];
  loading: boolean;
  error: string | null;
  onRetry: () => void;
  /** cuántos quedaron afuera por las protecciones; null si no se pudo medir */
  protectedCount: number | null;
  stats: ContactStats;
}) {
  const [abierto, setAbierto] = React.useState(false);

  const skipActive = audience.skip_active ?? true;
  const noRepetirDias = audience.no_broadcast_days ?? 7;
  const etapas = audience.stages ?? [];
  const etiquetas = audience.tags ?? [];

  const protecciones = skipActive || noRepetirDias > 0;
  const hayExclusiones =
    stats.total > 0 &&
    (stats.sinTelefono > 0 ||
      stats.bajas > 0 ||
      (protectedCount !== null && protectedCount > 0) ||
      (protectedCount === null && protecciones));

  // el `hint` de cada preset es una frase larga (dice por qué conviene mandarle
  // a esa gente): adentro del tile sería un ladrillo de letra chica, así que va
  // debajo y solo el del preset elegido
  const opcionesPreset = React.useMemo(
    () => AUDIENCE_PRESETS.map((p) => ({ value: p.key, label: p.label, icon: p.icon })),
    [],
  );
  const presetActual = AUDIENCE_PRESETS.find((p) => p.key === presetKey) ?? null;

  const resumen = React.useMemo(
    () =>
      describeAudience(audience, {
        tags: tags.map((t) => ({ id: t.id, name: t.name })),
        branches: branches.map((b) => ({ id: b.id, name: b.name })),
      }),
    [audience, tags, branches],
  );

  function toggleTag(id: string) {
    const next = etiquetas.includes(id)
      ? etiquetas.filter((t) => t !== id)
      : [...etiquetas, id];
    onFilters({ tags: next });
  }

  function toggleStage(stage: LeadStage) {
    const next = etapas.includes(stage)
      ? etapas.filter((s) => s !== stage)
      : [...etapas, stage];
    onFilters({ stages: next });
  }

  return (
    <div className="space-y-4">
      {/* presets: el camino de un toque, que es como se usa el lunes a la mañana */}
      <div className="space-y-2">
        <ChoiceGrid options={opcionesPreset} value={presetKey} onChange={onPreset} columns={2} />
        {presetActual && (
          <p className="text-[12.5px] leading-snug text-ink-soft animate-fade-in">
            {presetActual.hint}
          </p>
        )}
      </div>

      {/* filtros finos: plegados, porque el 90% de las veces alcanza un preset */}
      <div className="rounded-xl border border-line">
        <button
          type="button"
          onClick={() => setAbierto((o) => !o)}
          aria-expanded={abierto}
          className="flex min-h-11 w-full items-center justify-between gap-2 px-3.5 py-2.5 text-left tap-highlight-none"
        >
          <span className="flex items-center gap-2 text-[13px] font-medium text-ink-soft">
            <SlidersHorizontal className="size-4 text-ink-faint" strokeWidth={1.9} />
            Afinar a mano
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-ink-faint transition-transform duration-200",
              abierto && "rotate-180",
            )}
          />
        </button>

        {abierto && (
          <div className="space-y-4 border-t border-line p-3.5 animate-slide-up">
            <div>
              <Label>Clientes</Label>
              <Segmented
                value={audience.clients ?? "todos"}
                onChange={(v) => onFilters({ clients: v })}
                options={[
                  { value: "todos", label: "Todos" },
                  { value: "clientes", label: "Ya compraron" },
                  { value: "no_clientes", label: "Nunca compraron" },
                ]}
                className="w-full [&>button]:flex-1"
              />
            </div>

            {tags.length > 0 && (
              <div>
                <Label>Etiquetas</Label>
                <div className="flex flex-wrap gap-1.5">
                  {tags.map((t) => {
                    const activo = etiquetas.includes(t.id);
                    return (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => toggleTag(t.id)}
                        aria-pressed={activo}
                        className={cn(
                          "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-all tap-highlight-none active:scale-95",
                          activo
                            ? "border-brand-500 bg-brand-tint font-medium text-brand-text"
                            : "border-line bg-paper text-ink-soft hover:border-line-strong",
                        )}
                      >
                        <span
                          className={cn(
                            "size-2 shrink-0 rounded-full",
                            TAG_DOTS[t.color] ?? TAG_DOTS.gray,
                          )}
                          aria-hidden
                        />
                        {t.name}
                      </button>
                    );
                  })}
                </div>
                {etiquetas.length > 1 && (
                  <div className="mt-2">
                    <Segmented
                      value={audience.tags_mode ?? "any"}
                      onChange={(v) => onFilters({ tags_mode: v })}
                      options={[
                        { value: "any", label: "Cualquiera" },
                        { value: "all", label: "Todas juntas" },
                      ]}
                    />
                  </div>
                )}
              </div>
            )}

            <div>
              <Label>Etapa del último lead</Label>
              <div className="flex flex-wrap gap-1.5">
                {STAGES.map((s) => {
                  const activo = etapas.includes(s.key);
                  return (
                    <button
                      key={s.key}
                      type="button"
                      onClick={() => toggleStage(s.key)}
                      aria-pressed={activo}
                      className={cn(
                        "inline-flex min-h-8 items-center gap-1.5 rounded-full border px-2.5 text-[12.5px] transition-all tap-highlight-none active:scale-95",
                        activo
                          ? cn(s.chip, "font-medium")
                          : "border-line bg-paper text-ink-soft hover:border-line-strong",
                      )}
                    >
                      <span className={cn("size-2 shrink-0 rounded-full", s.dot)} aria-hidden />
                      {s.label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div>
                <Label htmlFor="aud-destino">Destino que consultó</Label>
                <Input
                  id="aud-destino"
                  value={audience.destination ?? ""}
                  onChange={(e) => onFilters({ destination: e.target.value || null })}
                  placeholder="Ej: Brasil"
                  maxLength={80}
                />
              </div>
              <div>
                <Label htmlFor="aud-cumple">Cumple años en</Label>
                <Select
                  id="aud-cumple"
                  value={audience.birthday_month ? String(audience.birthday_month) : ""}
                  onChange={(e) =>
                    onFilters({ birthday_month: e.target.value ? Number(e.target.value) : null })
                  }
                >
                  <option value="">Cualquier mes</option>
                  {MESES.map((m, i) => (
                    <option key={m} value={i + 1}>
                      {m.charAt(0).toUpperCase() + m.slice(1)}
                    </option>
                  ))}
                </Select>
              </div>
              {branches.length > 1 && (
                <div>
                  <Label htmlFor="aud-sucursal">Sucursal</Label>
                  <Select
                    id="aud-sucursal"
                    value={audience.branch_id ?? ""}
                    onChange={(e) => onFilters({ branch_id: e.target.value || null })}
                  >
                    <option value="">Todas</option>
                    {branches.map((b) => (
                      <option key={b.id} value={b.id}>
                        {b.name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
              {members.length > 1 && (
                <div>
                  <Label htmlFor="aud-vendedor">Vendedor</Label>
                  <Select
                    id="aud-vendedor"
                    value={audience.assigned_to ?? ""}
                    onChange={(e) => onFilters({ assigned_to: e.target.value || null })}
                  >
                    <option value="">Todos</option>
                    {members.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.display_name}
                      </option>
                    ))}
                  </Select>
                </div>
              )}
            </div>

            <div>
              <Label>Sin movimiento hace más de</Label>
              <Segmented
                value={audience.quiet_days ? String(audience.quiet_days) : ""}
                onChange={(v) => onFilters({ quiet_days: v ? Number(v) : null })}
                options={SILENCIO_OPCIONES}
                className="w-full [&>button]:flex-1"
              />
            </div>

            {/* protecciones: no son "un filtro más", cuidan el número y la relación */}
            <div className="space-y-3 rounded-xl border border-line bg-sand-soft/50 p-3">
              <label className="flex cursor-pointer items-center justify-between gap-3">
                <span className="min-w-0">
                  <span className="block text-[13px] font-medium text-ink">
                    No molestar a quien está negociando
                  </span>
                  <span className="block text-[11.5px] leading-snug text-ink-faint">
                    Una promo genérica arriba de un presupuesto en curso enfría la venta.
                  </span>
                </span>
                <Switch
                  checked={skipActive}
                  onCheckedChange={(v) => onCare({ skip_active: v })}
                  aria-label="No molestar a quien está negociando"
                />
              </label>
              <div>
                <Label>No repetirle si recibió una hace menos de</Label>
                <Segmented
                  value={String(noRepetirDias)}
                  onChange={(v) => onCare({ no_broadcast_days: Number(v) })}
                  options={REPETIR_OPCIONES}
                  className="w-full [&>button]:flex-1"
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {/* el contador: lo único que de verdad se mira antes de apretar */}
      <div
        aria-busy={loading}
        className="rounded-2xl border border-brand-tint-line bg-brand-tint p-4"
      >
        {resumen.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-1.5">
            {resumen.map((r) => (
              <span
                key={r}
                className="rounded-full border border-brand-tint-line bg-paper/70 px-2 py-0.5 text-[11px] font-medium text-brand-text"
              >
                {r}
              </span>
            ))}
          </div>
        )}

        {error ? (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="flex items-center gap-2 text-[13px] text-ink-soft">
              <TriangleAlert className="size-4 shrink-0 text-tone-amber-text" strokeWidth={1.9} />
              {error}
            </p>
            <Button variant="secondary" size="sm" onClick={onRetry}>
              <RotateCcw />
              Reintentar
            </Button>
          </div>
        ) : (
          <>
            <div className={cn("transition-opacity duration-200", loading && "opacity-50")}>
              {total === null ? (
                <Skeleton className="h-10 w-32" />
              ) : (
                <div className="flex items-end gap-2">
                  <AnimatedNumber
                    value={total}
                    from={0}
                    format={(n) => fmtNumber(n)}
                    className="font-display text-[38px] font-semibold leading-none text-ink"
                  />
                  <span className="pb-1 text-sm text-ink-soft">
                    {total === 1 ? "persona" : "personas"}
                  </span>
                </div>
              )}
            </div>

            {/* la muestra: la altura está reservada para que no salte el layout */}
            <div
              className={cn(
                "mt-3 min-h-[4.25rem] transition-opacity duration-200",
                loading && "opacity-50",
              )}
            >
              {total === null ? (
                <div className="flex flex-wrap gap-1.5">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <Skeleton key={i} className="h-7 w-28 rounded-full" />
                  ))}
                </div>
              ) : total === 0 ? (
                <p className="flex items-start gap-2 text-[13px] leading-snug text-ink-soft">
                  <UsersRound className="mt-px size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
                  Con estos filtros no queda nadie. Sacá alguno y probá de nuevo.
                </p>
              ) : (
                <>
                  <div className="flex flex-wrap gap-1.5">
                    {sample.map((c) => (
                      <span
                        key={c.contactId}
                        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-brand-tint-line bg-paper/70 py-0.5 pl-0.5 pr-2.5"
                      >
                        <Avatar name={c.fullName} className="size-6 text-[9px]" />
                        <span className="truncate text-[12px] font-medium text-ink">
                          {c.fullName}
                        </span>
                      </span>
                    ))}
                  </div>
                  {total > sample.length && (
                    <p className="mt-2 text-[12px] text-ink-soft">
                      y {fmtNumber(total - sample.length)} más.
                    </p>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </div>

      {/* a quién NO le llega: sin esto el usuario desconfía del número de arriba */}
      {hayExclusiones && (
        <div className="rounded-xl border border-line bg-sand-soft/40 p-3.5">
          <p className="text-[12.5px] font-medium text-ink-soft">
            De tus {fmtNumber(stats.total)} contactos, no a todos se les puede difundir.
          </p>
          <ul className="mt-2 space-y-1.5">
            {stats.sinTelefono > 0 && (
              <ExcluidoRow icon={PhoneOff}>
                {fmtNumber(stats.sinTelefono)} sin teléfono cargado.
              </ExcluidoRow>
            )}
            {stats.bajas > 0 && (
              <ExcluidoRow icon={Ban}>
                {fmtNumber(stats.bajas)} se dieron de baja de las difusiones.
              </ExcluidoRow>
            )}
            {protectedCount !== null && protectedCount > 0 && (
              <ExcluidoRow icon={ShieldCheck}>
                <span>
                  {fmtNumber(protectedCount)} protegidos: están en medio de una negociación o ya
                  recibieron una difusión hace poco.
                </span>{" "}
                <button
                  type="button"
                  onClick={() => onCare({ skip_active: false, no_broadcast_days: 0 })}
                  className="whitespace-nowrap font-medium text-brand-text underline underline-offset-2 tap-highlight-none"
                >
                  Incluirlos igual
                </button>
              </ExcluidoRow>
            )}
            {/* si la medición exacta no salió, se dice el motivo sin inventar el número */}
            {protectedCount === null && protecciones && (
              <ExcluidoRow icon={ShieldCheck}>
                También quedan afuera los que están en medio de una negociación y los que ya
                recibieron una difusión hace poco.
              </ExcluidoRow>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

function ExcluidoRow({
  icon: Icon,
  children,
}: {
  icon: React.ComponentType<{ className?: string; strokeWidth?: number }>;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-start gap-2 text-[12.5px] leading-snug text-ink-faint">
      <Icon className="mt-0.5 size-3.5 shrink-0" strokeWidth={1.9} />
      <span className="min-w-0">{children}</span>
    </li>
  );
}
