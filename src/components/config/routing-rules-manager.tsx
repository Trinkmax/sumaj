"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  ChevronDown,
  ChevronUp,
  CornerDownRight,
  Megaphone,
  MessageSquareText,
  Pencil,
  Plus,
  Route,
  Trash2,
  type LucideIcon,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input, Label, Select } from "@/components/ui/input";
import { ChoiceGrid, EmptyState, Switch } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { deleteRoutingRule, upsertRoutingRule } from "@/lib/actions/branches";
import { cn } from "@/lib/utils";

export type MatchType = "palabra" | "campana";

export type RoutingRuleRow = {
  id: string;
  branchId: string;
  branchName: string;
  branchColor: string;
  matchType: MatchType;
  pattern: string;
  isActive: boolean;
  position: number;
};

export type BranchOption = {
  id: string;
  name: string;
  color: string;
  is_default: boolean;
  is_active: boolean;
};

const MATCH_META: Record<
  MatchType,
  { label: string; icon: LucideIcon; verb: string; example: string }
> = {
  palabra: {
    label: "Palabra en el mensaje",
    icon: MessageSquareText,
    verb: "el mensaje dice",
    example: "bariloche",
  },
  campana: {
    label: "Campaña de origen",
    icon: Megaphone,
    verb: "la campaña dice",
    example: "verano-caribe",
  },
};

type Draft = {
  id?: string;
  branchId: string;
  matchType: MatchType;
  pattern: string;
  isActive: boolean;
};

const byPosition = (rows: RoutingRuleRow[]) => [...rows].sort((a, b) => a.position - b.position);

export function RoutingRulesManager({
  rules,
  branches,
  defaultBranchName,
  isAdmin,
}: {
  rules: RoutingRuleRow[];
  branches: BranchOption[];
  defaultBranchName: string | null;
  isAdmin: boolean;
}) {
  const [items, setItems] = React.useState(() => byPosition(rules));
  const [source, setSource] = React.useState(rules);
  const [draft, setDraft] = React.useState<Draft | null>(null);
  const [toDelete, setToDelete] = React.useState<RoutingRuleRow | null>(null);
  const [busy, setBusy] = React.useState(false);

  // el server es la verdad: si la página se revalida, la lista local se rehace
  // (ajuste durante el render, sin efecto ni frame viejo)
  if (rules !== source) {
    setSource(rules);
    setItems(byPosition(rules));
  }

  const branchById = new Map(branches.map((b) => [b.id, b]));
  const options = branches.filter((b) => b.is_active);
  const canCreate = isAdmin && options.length > 0;

  function openNew() {
    if (options.length === 0) return;
    setDraft({
      branchId: options.find((b) => b.is_default)?.id ?? options[0].id,
      matchType: "palabra",
      pattern: "",
      isActive: true,
    });
  }

  function persist(rule: RoutingRuleRow) {
    return upsertRoutingRule({
      id: rule.id,
      branchId: rule.branchId,
      matchType: rule.matchType,
      pattern: rule.pattern,
      isActive: rule.isActive,
      position: rule.position,
    });
  }

  async function toggleActive(rule: RoutingRuleRow, next: boolean) {
    const prev = items;
    setItems((s) => s.map((r) => (r.id === rule.id ? { ...r, isActive: next } : r))); // optimista
    const res = await persist({ ...rule, isActive: next });
    if (!res.ok) {
      setItems(prev);
      toast.error(res.error);
    }
  }

  async function move(index: number, dir: -1 | 1) {
    const target = index + dir;
    if (target < 0 || target >= items.length || busy) return;

    const prev = items;
    const swapped = [...items];
    [swapped[index], swapped[target]] = [swapped[target], swapped[index]];
    const next = swapped.map((r, i) => ({ ...r, position: i }));

    setBusy(true);
    setItems(next); // optimista

    const prevPosition = new Map(prev.map((r) => [r.id, r.position]));
    const changed = next.filter((r) => prevPosition.get(r.id) !== r.position);
    const results = await Promise.all(changed.map(persist));
    setBusy(false);

    if (results.some((r) => !r.ok)) {
      setItems(prev);
      toast.error("No se pudo cambiar el orden. Probá de nuevo.");
    }
  }

  async function saveDraft(d: Draft) {
    const pattern = d.pattern.trim();
    if (pattern.length < 2) {
      toast.error("Poné al menos 2 letras para buscar.");
      return false;
    }
    if (!d.branchId) {
      toast.error("Elegí a qué sucursal se deriva.");
      return false;
    }
    const position = d.id
      ? (items.find((r) => r.id === d.id)?.position ?? items.length)
      : items.length;

    const res = await upsertRoutingRule({
      id: d.id,
      branchId: d.branchId,
      matchType: d.matchType,
      pattern,
      isActive: d.isActive,
      position,
    });
    if (!res.ok) {
      toast.error(res.error);
      return false;
    }

    const branch = branches.find((b) => b.id === d.branchId);
    const row: RoutingRuleRow = {
      id: res.data.id,
      branchId: d.branchId,
      branchName: branch?.name ?? "Sucursal",
      branchColor: branch?.color ?? "gray",
      matchType: d.matchType,
      pattern,
      isActive: d.isActive,
      position,
    };
    setItems((s) => (d.id ? s.map((r) => (r.id === d.id ? row : r)) : [...s, row]));
    toast.success(d.id ? "Regla guardada." : `Las consultas con "${pattern}" van a ${row.branchName}.`);
    return true;
  }

  return (
    <section className="card p-5 animate-fade-in">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-lg font-semibold text-ink">Derivación a sucursales</h2>
          <p className="mt-0.5 text-sm text-ink-soft">
            Deciden a qué sucursal va cada consulta nueva que entra por el número madre.
          </p>
        </div>
        {canCreate && (
          <Button onClick={openNew} className="shrink-0">
            <Plus />
            <span className="hidden sm:inline">Nueva regla</span>
            <span className="sm:hidden">Nueva</span>
          </Button>
        )}
      </div>

      {items.length === 0 ? (
        <EmptyState
          className="mt-4"
          icon={Route}
          title="Todavía no hay reglas"
          description='Sirven para que cada consulta caiga en la sucursal correcta: si el mensaje dice "bariloche", que la atienda Centro.'
          action={
            canCreate ? (
              <Button onClick={openNew}>
                <Plus />
                Crear la primera
              </Button>
            ) : undefined
          }
        />
      ) : (
        <>
          <p className="mt-4 text-xs text-ink-faint">
            Se leen de arriba hacia abajo: la primera que matchea gana.
          </p>

          <ul className="mt-2.5 space-y-2.5 stagger-children">
            {items.map((rule, i) => {
              const meta = MATCH_META[rule.matchType];
              const branchOff = branchById.get(rule.branchId)?.is_active === false;
              return (
                <li
                  key={rule.id}
                  className={cn(
                    "rounded-2xl border border-line bg-sand-soft/40 p-3.5 transition-opacity",
                    !rule.isActive && "opacity-60",
                  )}
                >
                  <div className="flex items-start gap-3">
                    <span className="flex size-7 shrink-0 items-center justify-center rounded-full border border-line bg-paper text-[12px] font-semibold text-ink-soft tabular-nums">
                      {i + 1}
                    </span>

                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm text-ink">
                        <meta.icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.9} />
                        <span className="text-ink-soft">Si {meta.verb}</span>
                        <span className="max-w-full truncate rounded-md bg-paper px-1.5 py-0.5 font-medium text-ink">
                          {rule.pattern}
                        </span>
                      </p>
                      <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-[13px] text-ink-soft">
                        <CornerDownRight className="size-3.5 shrink-0 text-ink-faint" />
                        <Badge color={rule.branchColor}>{rule.branchName}</Badge>
                        {branchOff && (
                          <span className="text-[12px] text-tone-amber-text">
                            La sucursal está inactiva
                          </span>
                        )}
                      </p>
                    </div>

                    <Switch
                      checked={rule.isActive}
                      onCheckedChange={(v) => toggleActive(rule, v)}
                      disabled={!isAdmin}
                      aria-label={`Regla ${rule.pattern} activa`}
                    />
                  </div>

                  {isAdmin && (
                    <div className="mt-2.5 flex items-center justify-end gap-1 border-t border-line pt-2">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        disabled={i === 0 || busy}
                        onClick={() => move(i, -1)}
                        aria-label={`Subir la regla ${rule.pattern}`}
                      >
                        <ChevronUp />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        disabled={i === items.length - 1 || busy}
                        onClick={() => move(i, 1)}
                        aria-label={`Bajar la regla ${rule.pattern}`}
                      >
                        <ChevronDown />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 sm:size-9"
                        onClick={() =>
                          setDraft({
                            id: rule.id,
                            branchId: rule.branchId,
                            matchType: rule.matchType,
                            pattern: rule.pattern,
                            isActive: rule.isActive,
                          })
                        }
                        aria-label={`Editar la regla ${rule.pattern}`}
                      >
                        <Pencil />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="size-11 text-tone-red-text hover:bg-tone-red-soft sm:size-9"
                        onClick={() => setToDelete(rule)}
                        aria-label={`Eliminar la regla ${rule.pattern}`}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <p className="mt-4 text-xs leading-relaxed text-ink-faint">
        {defaultBranchName
          ? `Si no matchea ninguna, la consulta cae en la sucursal por defecto (hoy es ${defaultBranchName}). `
          : "Ninguna sucursal activa está marcada como por defecto: si no matchea ninguna regla, la consulta queda sin sucursal. "}
        <Link href="/config/sucursales" className="font-medium text-brand-600 hover:underline">
          Ver sucursales
        </Link>
      </p>

      {isAdmin && options.length === 0 && (
        <p className="mt-2 text-xs text-ink-faint">
          Creá una sucursal para poder derivar las consultas.
        </p>
      )}

      <RuleDialog
        draft={draft}
        branches={branches}
        onOpenChange={(o) => !o && setDraft(null)}
        onSave={saveDraft}
      />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title="¿Eliminar la regla?"
        description={
          toDelete
            ? `Las consultas con "${toDelete.pattern}" van a pasar a la sucursal por defecto.`
            : ""
        }
        onConfirm={async () => {
          if (!toDelete) return;
          const res = await deleteRoutingRule({ id: toDelete.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            setItems((s) => s.filter((r) => r.id !== toDelete.id));
            toast.success("Regla eliminada.");
          }
          setToDelete(null);
        }}
      />
    </section>
  );
}

function RuleDialog({
  draft,
  branches,
  onOpenChange,
  onSave,
}: {
  draft: Draft | null;
  branches: BranchOption[];
  onOpenChange: (o: boolean) => void;
  onSave: (d: Draft) => Promise<boolean>;
}) {
  const [form, setForm] = React.useState<Draft | null>(draft);
  const [source, setSource] = React.useState<Draft | null>(draft);
  const [loading, setLoading] = React.useState(false);

  // El draft que llega del padre manda (abre en alta o en edición). Se ajusta
  // durante el render (sin efecto) para que no se vea un frame con lo anterior.
  // Al cerrar no lo limpiamos: así el diálogo alcanza a animar la salida.
  if (draft && draft !== source) {
    setSource(draft);
    setForm(draft);
  }

  if (!form) return null;
  const f = form;
  const meta = MATCH_META[f.matchType];
  // las inactivas no se ofrecen, pero si la regla ya apunta a una hay que
  // mostrarla: si no, el <select> caería en la primera y la cambiaría sin avisar
  const list = branches.filter((b) => b.is_active || b.id === f.branchId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const ok = await onSave(f);
    setLoading(false);
    if (ok) onOpenChange(false);
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent
        title={draft?.id ? "Editar regla" : "Nueva regla"}
        description="Qué buscar en la consulta y a qué sucursal mandarla."
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label>Qué mirar</Label>
            <ChoiceGrid
              columns={2}
              value={f.matchType}
              onChange={(v) => setForm({ ...f, matchType: v })}
              options={[
                { value: "palabra" as MatchType, label: MATCH_META.palabra.label, icon: MessageSquareText },
                { value: "campana" as MatchType, label: MATCH_META.campana.label, icon: Megaphone },
              ]}
            />
          </div>

          <div>
            <Label htmlFor="rule-pattern">Texto a buscar *</Label>
            <Input
              id="rule-pattern"
              required
              value={f.pattern}
              onChange={(e) => setForm({ ...f, pattern: e.target.value })}
              placeholder={meta.example}
              maxLength={60}
              autoFocus
            />
            <p className="mt-1.5 text-xs text-ink-faint">
              {f.matchType === "palabra"
                ? "Matchea si aparece en cualquier parte del mensaje, sin importar mayúsculas."
                : "Matchea con el nombre de la campaña o del anuncio que trajo la consulta."}
            </p>
          </div>

          <div>
            <Label htmlFor="rule-branch">Sucursal destino *</Label>
            <Select
              id="rule-branch"
              value={f.branchId}
              onChange={(e) => setForm({ ...f, branchId: e.target.value })}
            >
              {list.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                  {!b.is_active ? " (inactiva)" : b.is_default ? " (por defecto)" : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="flex items-center justify-between gap-3 rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">Regla activa</p>
              <p className="text-xs text-ink-faint">Si la apagás, deja de derivar sin borrarse.</p>
            </div>
            <Switch
              checked={f.isActive}
              onCheckedChange={(v) => setForm({ ...f, isActive: v })}
              aria-label="Regla activa"
            />
          </div>

          <div className="flex justify-end gap-2 pt-1">
            <Button
              type="button"
              variant="secondary"
              onClick={() => onOpenChange(false)}
              disabled={loading}
            >
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              {draft?.id ? "Guardar" : "Crear regla"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
