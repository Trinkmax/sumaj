"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Check,
  ChevronDown,
  MapPin,
  MoreHorizontal,
  Pencil,
  Phone,
  Plus,
  Store,
  Trash2,
  UserRound,
  UsersRound,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
  DropdownSeparator,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Input, Label } from "@/components/ui/input";
import { EmptyState, Switch } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import { ChannelLinkCard, type ChannelCard } from "@/components/config/channel-link-card";
import { deleteBranch, setMemberBranch, upsertBranch } from "@/lib/actions/branches";
import { TAG_COLORS, TAG_DOTS } from "@/lib/domain";
import { fmtPhone } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/lib/types";

export type BranchItem = {
  id: string;
  name: string;
  address: string | null;
  phone: string | null;
  color: string;
  is_default: boolean;
  is_active: boolean;
  channel: ChannelCard | null;
};

export type BranchMember = {
  id: string;
  display_name: string;
  avatar_url: string | null;
  role: MemberRole;
  branch_id: string | null;
};

const ROLE_LABEL: Record<MemberRole, string> = {
  admin: "Socio/Admin",
  vendedor: "Vendedor",
  freelance: "Freelance",
};

/** Lo que se está editando en el diálogo (null = cerrado). */
type BranchDraft = {
  id?: string;
  name: string;
  address: string;
  phone: string;
  color: string;
  isDefault: boolean;
  isActive: boolean;
};

const GENERIC_ERROR = "No se pudo guardar. Revisá tu conexión y probá de nuevo.";

export function BranchesManager({
  branches,
  members,
  isAdmin,
  workerReady,
}: {
  branches: BranchItem[];
  members: BranchMember[];
  isAdmin: boolean;
  workerReady: boolean;
}) {
  const [draft, setDraft] = React.useState<BranchDraft | null>(null);
  const [toDelete, setToDelete] = React.useState<BranchItem | null>(null);
  /* mudanzas optimistas por miembro; se aplican encima de lo que trae el server */
  const [moved, setMoved] = React.useState<Record<string, string | null>>({});

  const team = React.useMemo(() => {
    const alive = new Set(branches.map((b) => b.id));
    return members.map((m) => {
      const override = moved[m.id];
      // si la sucursal de la mudanza ya no existe, vale lo que dice el server
      if (override === undefined || (override !== null && !alive.has(override))) return m;
      return { ...m, branch_id: override };
    });
  }, [members, moved, branches]);

  function openNew() {
    setDraft({
      name: "",
      address: "",
      phone: "",
      color: "sky",
      // la primera sucursal es la que recibe lo que no matchea ninguna regla
      isDefault: branches.length === 0,
      isActive: true,
    });
  }

  function openEdit(b: BranchItem) {
    setDraft({
      id: b.id,
      name: b.name,
      address: b.address ?? "",
      phone: b.phone ?? "",
      color: b.color,
      isDefault: b.is_default,
      isActive: b.is_active,
    });
  }

  /** Mover un vendedor de sucursal, optimista. */
  async function moveMember(memberId: string, branchId: string | null) {
    const previous = moved[memberId];
    setMoved((prev) => ({ ...prev, [memberId]: branchId }));

    /** vuelve a como estaba: sin override propio, manda lo que dice el server */
    const revert = () =>
      setMoved((prev) => {
        const next = { ...prev };
        if (previous === undefined) delete next[memberId];
        else next[memberId] = previous;
        return next;
      });

    try {
      const res = await setMemberBranch({ memberId, branchId });
      if (!res.ok) {
        revert();
        toast.error(res.error);
        return;
      }
      const target = branchId ? branches.find((b) => b.id === branchId)?.name : null;
      toast.success(target ? `Pasó a ${target}.` : "Quedó sin sucursal: ve todas.");
    } catch {
      revert();
      toast.error("No se pudo mover. Revisá tu conexión y probá de nuevo.");
    }
  }

  const loose = team.filter((m) => !m.branch_id);

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-sm text-ink-soft">
          Cada sucursal tiene su propio WhatsApp. Desde ese número el operador contesta al cliente
          sin límite de tiempo ni plantillas.
        </p>
        {isAdmin && (
          <Button onClick={openNew} className="shrink-0">
            <Plus />
            <span className="hidden sm:inline">Nueva sucursal</span>
            <span className="sm:hidden">Nueva</span>
          </Button>
        )}
      </div>

      {branches.length === 0 ? (
        <EmptyState
          icon={Store}
          title="Todavía no hay sucursales"
          description="Creá la primera para vincular su WhatsApp y empezar a derivar consultas."
          action={
            isAdmin ? (
              <Button onClick={openNew}>
                <Plus />
                Crear sucursal
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="space-y-4 stagger-children">
          {branches.map((branch) => (
            <BranchCard
              key={branch.id}
              branch={branch}
              branches={branches}
              members={team.filter((m) => m.branch_id === branch.id)}
              isAdmin={isAdmin}
              workerReady={workerReady}
              onEdit={() => openEdit(branch)}
              onDelete={() => setToDelete(branch)}
              onMoveMember={moveMember}
            />
          ))}
        </div>
      )}

      {/* Gente sin sucursal: típicamente los admins */}
      {loose.length > 0 && (
        <section className="card p-5 animate-fade-in">
          <div className="flex items-center gap-2">
            <UsersRound className="size-4 text-ink-faint" strokeWidth={1.9} aria-hidden />
            <h2 className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">
              Sin sucursal — ven todas
            </h2>
          </div>
          <ul className="mt-3 divide-y divide-line">
            {loose.map((m) => (
              <MemberRow
                key={m.id}
                member={m}
                branches={branches}
                isAdmin={isAdmin}
                onMove={moveMember}
              />
            ))}
          </ul>
        </section>
      )}

      <BranchDialog draft={draft} onOpenChange={(o) => !o && setDraft(null)} />

      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={(o) => !o && setToDelete(null)}
        title={`¿Eliminar ${toDelete?.name}?`}
        description="Se borra también su número de WhatsApp. Si tiene leads o ventas asociadas no se va a poder: en ese caso desactivala."
        onConfirm={async () => {
          if (!toDelete) return;
          try {
            const res = await deleteBranch({ id: toDelete.id });
            if (!res.ok) {
              toast.error(res.error);
              return;
            }
            toast.success("Sucursal eliminada.");
            setToDelete(null);
          } catch {
            toast.error("No se pudo eliminar. Revisá tu conexión y probá de nuevo.");
          }
        }}
      />
    </div>
  );
}

/* ───────────────────────────────────────────
   Card de sucursal
   ─────────────────────────────────────────── */

function BranchCard({
  branch,
  branches,
  members,
  isAdmin,
  workerReady,
  onEdit,
  onDelete,
  onMoveMember,
}: {
  branch: BranchItem;
  branches: BranchItem[];
  members: BranchMember[];
  isAdmin: boolean;
  workerReady: boolean;
  onEdit: () => void;
  onDelete: () => void;
  onMoveMember: (memberId: string, branchId: string | null) => void;
}) {
  const [openTeam, setOpenTeam] = React.useState(false);
  const visible = members.slice(0, 4);
  const extra = members.length - visible.length;

  return (
    <section className={cn("card p-5", !branch.is_active && "opacity-60")}>
      <div className="flex items-start gap-3">
        <span
          className={cn(
            "mt-1 size-3 shrink-0 rounded-full",
            TAG_DOTS[branch.color] ?? TAG_DOTS.gray,
          )}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="font-display text-lg font-semibold leading-tight text-ink">
              {branch.name}
            </h2>
            {branch.is_default && (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[11px] font-medium",
                  TAG_COLORS[branch.color] ?? TAG_COLORS.gray,
                )}
              >
                Por defecto
              </span>
            )}
            {!branch.is_active && (
              <span className="rounded-full border border-tone-stone-line bg-tone-stone-soft px-2 py-0.5 text-[11px] font-medium text-tone-stone-text">
                Pausada
              </span>
            )}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-ink-faint">
            {branch.address && (
              <span className="inline-flex items-center gap-1.5">
                <MapPin className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                <span className="truncate">{branch.address}</span>
              </span>
            )}
            {branch.phone && (
              <span className="inline-flex items-center gap-1.5 tabular-nums">
                <Phone className="size-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                {fmtPhone(branch.phone)}
              </span>
            )}
          </div>
        </div>

        {isAdmin && (
          <Dropdown>
            <DropdownTrigger asChild>
              <Button
                size="icon"
                variant="ghost"
                aria-label={`Acciones de ${branch.name}`}
                className="-mr-1.5 size-11 shrink-0 sm:size-9"
              >
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownItem onSelect={onEdit}>
                <Pencil />
                Editar sucursal
              </DropdownItem>
              <DropdownSeparator />
              <DropdownItem destructive onSelect={onDelete}>
                <Trash2 />
                Eliminar
              </DropdownItem>
            </DropdownContent>
          </Dropdown>
        )}
      </div>

      {/* Vendedores */}
      <div className="mt-4">
        <button
          type="button"
          onClick={() => setOpenTeam((o) => !o)}
          aria-expanded={openTeam}
          className="flex min-h-11 w-full items-center gap-3 rounded-xl px-1 text-left transition-colors hover:bg-sand-soft/60 tap-highlight-none"
        >
          {members.length > 0 ? (
            <span className="flex shrink-0 -space-x-2">
              {visible.map((m) => (
                <Avatar
                  key={m.id}
                  name={m.display_name}
                  src={m.avatar_url}
                  className="size-7 text-[10px] ring-2 ring-paper"
                />
              ))}
              {extra > 0 && (
                <span className="flex size-7 items-center justify-center rounded-full bg-sand-deep text-[10px] font-semibold text-ink-soft ring-2 ring-paper">
                  +{extra}
                </span>
              )}
            </span>
          ) : (
            <span className="flex size-7 shrink-0 items-center justify-center rounded-full bg-sand-soft text-ink-faint">
              <UserRound className="size-3.5" strokeWidth={1.9} aria-hidden />
            </span>
          )}
          <span className="min-w-0 flex-1 truncate text-[13px] text-ink-soft">
            {members.length === 0
              ? "Sin vendedores asignados"
              : members.length === 1
                ? "1 vendedor"
                : `${members.length} vendedores`}
          </span>
          <ChevronDown
            className={cn(
              "size-4 shrink-0 text-ink-faint transition-transform",
              openTeam && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {openTeam && (
          <div className="mt-1 animate-fade-in">
            {members.length === 0 ? (
              <p className="px-1 py-2 text-[13px] text-ink-faint">
                {isAdmin
                  ? "Movés gente acá desde la lista de abajo o desde otra sucursal."
                  : "Todavía no hay nadie asignado."}
              </p>
            ) : (
              <ul className="divide-y divide-line">
                {members.map((m) => (
                  <MemberRow
                    key={m.id}
                    member={m}
                    branches={branches}
                    isAdmin={isAdmin}
                    onMove={onMoveMember}
                  />
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* WhatsApp de la sucursal */}
      <div className="mt-4">
        {branch.channel ? (
          <ChannelLinkCard
            channel={branch.channel}
            workerReady={workerReady}
            isAdmin={isAdmin}
          />
        ) : (
          <div className="rounded-2xl border border-dashed border-line-strong bg-sand-soft/50 px-4 py-3 text-[13px] text-ink-faint">
            Esta sucursal quedó sin número de WhatsApp propio. Escribile a soporte y lo dejamos
            listo.
          </div>
        )}
      </div>
    </section>
  );
}

/* ───────────────────────────────────────────
   Fila de vendedor (con cambio de sucursal)
   ─────────────────────────────────────────── */

function MemberRow({
  member,
  branches,
  isAdmin,
  onMove,
}: {
  member: BranchMember;
  branches: BranchItem[];
  isAdmin: boolean;
  onMove: (memberId: string, branchId: string | null) => void;
}) {
  return (
    <li className="flex min-h-14 items-center gap-3 px-1 py-2">
      <Avatar name={member.display_name} src={member.avatar_url} className="size-9" />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{member.display_name}</p>
        <p className="mt-0.5 truncate text-xs text-ink-faint">{ROLE_LABEL[member.role]}</p>
      </div>

      {isAdmin && (
        <Dropdown>
          <DropdownTrigger asChild>
            <Button
              size="sm"
              variant="secondary"
              className="h-11 shrink-0 sm:h-9"
              aria-label={`Cambiar la sucursal de ${member.display_name}`}
            >
              Mover
              <ChevronDown />
            </Button>
          </DropdownTrigger>
          <DropdownContent align="end">
            <DropdownLabel>Mover a</DropdownLabel>
            {branches.map((b) => (
              <DropdownItem
                key={b.id}
                onSelect={() => member.branch_id !== b.id && onMove(member.id, b.id)}
              >
                <span
                  className={cn(
                    "size-2 shrink-0 rounded-full",
                    TAG_DOTS[b.color] ?? TAG_DOTS.gray,
                  )}
                  aria-hidden
                />
                <span className="min-w-0 flex-1 truncate">{b.name}</span>
                {member.branch_id === b.id && <Check className="size-3.5" strokeWidth={3} />}
              </DropdownItem>
            ))}
            <DropdownSeparator />
            <DropdownItem
              onSelect={() => member.branch_id !== null && onMove(member.id, null)}
            >
              <span className="min-w-0 flex-1 truncate">Sin sucursal (ve todas)</span>
              {member.branch_id === null && <Check className="size-3.5" strokeWidth={3} />}
            </DropdownItem>
          </DropdownContent>
        </Dropdown>
      )}
    </li>
  );
}

/* ───────────────────────────────────────────
   Alta / edición
   ─────────────────────────────────────────── */

function BranchDialog({
  draft,
  onOpenChange,
}: {
  draft: BranchDraft | null;
  onOpenChange: (o: boolean) => void;
}) {
  const [form, setForm] = React.useState<BranchDraft | null>(draft);
  const [source, setSource] = React.useState<BranchDraft | null>(draft);
  const [loading, setLoading] = React.useState(false);

  // El draft del padre manda (abre en alta o en edición) y se ajusta durante el
  // render, sin efecto: así el formulario nunca arrastra lo que se cargó la vez
  // anterior. Al cerrar no lo limpiamos, para que alcance a animar la salida.
  if (draft && draft !== source) {
    setSource(draft);
    setForm(draft);
  }

  if (!form) return null;
  const f = form;
  const editing = Boolean(f.id);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const name = f.name.trim();
    if (name.length < 2) {
      toast.error("Poné un nombre de al menos 2 letras.");
      return;
    }
    setLoading(true);
    try {
      const res = await upsertBranch({
        id: f.id,
        name,
        address: f.address.trim() || null,
        phone: f.phone.trim() || null,
        color: f.color,
        is_default: f.isDefault,
        is_active: f.isActive,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      toast.success(
        f.id ? "Sucursal guardada." : `${name} lista. Vinculá su WhatsApp cuando quieras.`,
      );
      onOpenChange(false);
    } catch {
      toast.error(GENERIC_ERROR);
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog open={draft !== null} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent
        title={editing ? "Editar sucursal" : "Nueva sucursal"}
        description="Cada sucursal tiene su equipo y su número de WhatsApp."
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="branch-name">Nombre *</Label>
            <Input
              id="branch-name"
              required
              value={f.name}
              onChange={(e) => setForm({ ...f, name: e.target.value })}
              placeholder="Ej: Nueva Córdoba"
              maxLength={60}
              autoFocus
            />
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="branch-address">Dirección</Label>
              <Input
                id="branch-address"
                value={f.address}
                onChange={(e) => setForm({ ...f, address: e.target.value })}
                placeholder="Independencia 850"
                maxLength={160}
              />
            </div>
            <div>
              <Label htmlFor="branch-phone">Teléfono</Label>
              <Input
                id="branch-phone"
                value={f.phone}
                onChange={(e) => setForm({ ...f, phone: e.target.value })}
                placeholder="+54 9 351 555-0000"
                inputMode="tel"
                maxLength={40}
              />
            </div>
          </div>

          <div>
            <Label>Color</Label>
            <div className="flex flex-wrap gap-2.5">
              {Object.keys(TAG_COLORS).map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() => setForm({ ...f, color: key })}
                  aria-label={`Color ${key}`}
                  aria-pressed={f.color === key}
                  className={cn(
                    "relative flex size-10 items-center justify-center rounded-full transition-all tap-highlight-none active:scale-90",
                    TAG_DOTS[key] ?? TAG_DOTS.gray,
                    f.color === key
                      ? "scale-110 ring-2 ring-ink ring-offset-2 ring-offset-paper"
                      : "opacity-85 hover:scale-105 hover:opacity-100",
                  )}
                >
                  {f.color === key && (
                    <Check className="size-4 text-white animate-check-pop" strokeWidth={3} />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3 rounded-xl border border-line bg-sand-soft/50 px-3.5 py-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Es la sucursal por defecto</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
                  Ahí caen las consultas que no matchean ninguna regla.
                </p>
              </div>
              <Switch
                checked={f.isDefault}
                onCheckedChange={(v) => setForm({ ...f, isDefault: v })}
                aria-label="Sucursal por defecto"
                className="mt-0.5 shrink-0"
              />
            </div>
            <div className="flex items-start justify-between gap-3 border-t border-line pt-3">
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">Activa</p>
                <p className="mt-0.5 text-[12px] leading-relaxed text-ink-faint">
                  Si la pausás, deja de recibir derivaciones.
                </p>
              </div>
              <Switch
                checked={f.isActive}
                onCheckedChange={(v) => setForm({ ...f, isActive: v })}
                aria-label="Sucursal activa"
                className="mt-0.5 shrink-0"
              />
            </div>
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
              {editing ? "Guardar" : "Crear sucursal"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
