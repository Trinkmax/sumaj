"use client";

import * as React from "react";
import { toast } from "sonner";
import { Check, ChevronDown, Copy, MailPlus, Trash2, UserPlus } from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Input, Label, Select } from "@/components/ui/input";
import { Switch, Tooltip, EmptyState } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import {
  createInvitation,
  deleteInvitation,
  toggleMemberActive,
  updateMemberCommission,
  updateMemberRole,
} from "@/lib/actions/settings";
import type { MemberRole, Tables } from "@/lib/types";
import { cn } from "@/lib/utils";

type Member = Tables<"members">;
type Invitation = Tables<"invitations">;

const ROLE_META: Record<MemberRole, { label: string; chip: string; dot: string }> = {
  admin: {
    label: "Socio/Admin",
    chip: "bg-brand-tint text-brand-text border-brand-tint-line",
    dot: "bg-brand-500",
  },
  vendedor: {
    label: "Vendedor",
    chip: "bg-tone-sky-soft text-tone-sky-text border-tone-sky-line",
    dot: "bg-sky-500",
  },
  freelance: {
    label: "Freelance",
    chip: "bg-tone-violet-soft text-tone-violet-text border-tone-violet-line",
    dot: "bg-violet-500",
  },
};

const ROLE_OPTIONS: { value: MemberRole; label: string }[] = [
  { value: "admin", label: "Socio/Admin" },
  { value: "vendedor", label: "Vendedor" },
  { value: "freelance", label: "Freelance" },
];

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

function inviteMessage(agencyName: string) {
  return `Sumate al sistema de ${agencyName}: registrate con este email en ${appUrl()}/registro`;
}

export function TeamSection({
  members,
  invitations,
  currentMemberId,
  agencyName,
}: {
  members: Member[];
  invitations: Invitation[];
  currentMemberId: string;
  agencyName: string;
}) {
  const [inviteOpen, setInviteOpen] = React.useState(false);

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 className="font-display text-lg font-semibold text-ink">Equipo</h2>
            <p className="text-sm text-ink-faint">
              {members.filter((m) => m.is_active).length} activos · la comisión es el % sobre la
              utilidad de cada file
            </p>
          </div>
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus />
            <span className="hidden sm:inline">Invitar</span>
          </Button>
        </div>
        <ul className="divide-y divide-line stagger-children">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} isSelf={m.id === currentMemberId} />
          ))}
        </ul>
      </section>

      <section className="card p-5 animate-fade-in">
        <h2 className="font-display text-lg font-semibold text-ink">Invitaciones pendientes</h2>
        <p className="mt-0.5 text-sm text-ink-faint">
          Cuando la persona se registre con ese email, entra sola al equipo.
        </p>
        {invitations.length === 0 ? (
          <EmptyState
            icon={MailPlus}
            title="No hay invitaciones pendientes"
            description="Invitá a alguien y pasale el mensaje para que se registre."
            className="mt-4 py-8"
          />
        ) : (
          <ul className="mt-4 divide-y divide-line">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} agencyName={agencyName} />
            ))}
          </ul>
        )}
      </section>

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} agencyName={agencyName} />
    </div>
  );
}

/* ── Selector de rol como chip tonal ── */

function RoleChip({
  role,
  memberName,
  disabled,
  onSelect,
}: {
  role: MemberRole;
  memberName: string;
  disabled?: boolean;
  onSelect: (r: MemberRole) => void;
}) {
  const meta = ROLE_META[role] ?? ROLE_META.vendedor;
  const chipCls =
    "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[12px] font-medium leading-4 transition-all tap-highlight-none";

  if (disabled) {
    return (
      <Tooltip content="Tu propio rol no se cambia desde acá">
        <span className={cn(chipCls, meta.chip, "opacity-80")}>
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
        </span>
      </Tooltip>
    );
  }

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          aria-label={`Rol de ${memberName}: ${meta.label}. Cambiar`}
          className={cn(chipCls, meta.chip, "cursor-pointer active:scale-95")}
        >
          <span className={cn("size-1.5 rounded-full", meta.dot)} />
          {meta.label}
          <ChevronDown className="size-3 opacity-60" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="end" className="min-w-[160px]">
        {ROLE_OPTIONS.map((r) => (
          <DropdownItem key={r.value} onSelect={() => r.value !== role && onSelect(r.value)}>
            <span className={cn("size-1.5 rounded-full", ROLE_META[r.value].dot)} />
            {r.label}
            {r.value === role && <Check className="ml-auto size-3.5" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
  );
}

/* ── Fila de miembro ── */

function MemberRow({ member, isSelf }: { member: Member; isSelf: boolean }) {
  const [role, setRole] = React.useState<MemberRole>(member.role);
  const [active, setActive] = React.useState(member.is_active);
  const [commission, setCommission] = React.useState(String(member.commission_pct));
  const lastSavedCommission = React.useRef(member.commission_pct);

  async function changeRole(next: MemberRole) {
    const prev = role;
    setRole(next); // optimista
    const res = await updateMemberRole({ memberId: member.id, role: next });
    if (!res.ok) {
      setRole(prev);
      toast.error(res.error);
      return;
    }
    toast.success(`${member.display_name} ahora es ${ROLE_META[next].label}.`);
  }

  async function toggleActive(next: boolean) {
    const prev = active;
    setActive(next); // optimista
    const res = await toggleMemberActive({ memberId: member.id, is_active: next });
    if (!res.ok) {
      setActive(prev);
      toast.error(res.error);
    }
  }

  async function saveCommission() {
    const n = Number(commission.replace(",", "."));
    if (isNaN(n) || n < 0 || n > 100) {
      toast.error("La comisión tiene que estar entre 0 y 100.");
      setCommission(String(lastSavedCommission.current));
      return;
    }
    if (n === lastSavedCommission.current) return;
    const prev = lastSavedCommission.current;
    lastSavedCommission.current = n;
    const res = await updateMemberCommission({ memberId: member.id, commission_pct: n });
    if (!res.ok) {
      lastSavedCommission.current = prev;
      setCommission(String(prev));
      toast.error(res.error);
      return;
    }
    toast.success("Comisión guardada.");
  }

  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-5 py-3.5 transition-opacity", !active && "opacity-55")}>
      <div className="flex min-w-0 flex-1 items-center gap-3">
        <Avatar name={member.display_name} src={member.avatar_url} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">
            {member.display_name}
            {isSelf && <span className="ml-1.5 text-xs font-normal text-ink-faint">(vos)</span>}
          </p>
          <p className="truncate text-xs text-ink-faint">{member.email ?? "Sin email"}</p>
        </div>
      </div>

      <div className="flex w-full items-center gap-2 pl-12 sm:w-auto sm:pl-0">
        <RoleChip
          role={role}
          memberName={member.display_name}
          disabled={isSelf}
          onSelect={changeRole}
        />

        <div className="relative">
          <Input
            value={commission}
            onChange={(e) => setCommission(e.target.value)}
            onBlur={saveCommission}
            onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
            inputMode="decimal"
            aria-label={`Comisión de ${member.display_name}`}
            className="h-9 w-[72px] pr-6 text-right text-[13px] tabular-nums"
          />
          <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-ink-faint">
            %
          </span>
        </div>

        <Tooltip content={isSelf ? "No podés desactivarte a vos mismo" : active ? "Activo" : "Inactivo"}>
          <span className="inline-flex">
            <Switch
              checked={active}
              onCheckedChange={toggleActive}
              disabled={isSelf}
              aria-label={`${member.display_name} activo`}
            />
          </span>
        </Tooltip>
      </div>
    </li>
  );
}

/* ── Invitación pendiente ── */

function InvitationRow({
  invitation,
  agencyName,
}: {
  invitation: Invitation;
  agencyName: string;
}) {
  const [confirmOpen, setConfirmOpen] = React.useState(false);

  function copyMessage() {
    navigator.clipboard
      .writeText(inviteMessage(agencyName))
      .then(() => toast.success("Mensaje copiado. Pasáselo por WhatsApp."))
      .catch(() => toast.error("No se pudo copiar. Copialo a mano."));
  }

  return (
    <li className="flex items-center gap-3 py-3">
      <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-brand-tint text-brand-text">
        <MailPlus className="size-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-ink">{invitation.email}</p>
        <p className="truncate text-xs text-ink-faint">
          {invitation.display_name ? `${invitation.display_name} · ` : ""}
          {ROLE_META[invitation.role]?.label ?? invitation.role}
          {invitation.commission_pct > 0 ? ` · ${invitation.commission_pct}% comisión` : ""}
        </p>
      </div>
      <span className="inline-flex shrink-0 items-center rounded-full border border-tone-amber-line bg-tone-amber-soft px-2 py-0.5 text-[11px] font-medium leading-4 text-tone-amber-text">
        Pendiente
      </span>
      <Tooltip content="Copiar mensaje de invitación">
        <Button size="icon-sm" variant="ghost" onClick={copyMessage} aria-label="Copiar mensaje">
          <Copy />
        </Button>
      </Tooltip>
      <Tooltip content="Eliminar invitación">
        <Button
          size="icon-sm"
          variant="ghost"
          onClick={() => setConfirmOpen(true)}
          aria-label="Eliminar invitación"
          className="text-tone-red-text hover:bg-tone-red-soft hover:text-tone-red-text"
        >
          <Trash2 />
        </Button>
      </Tooltip>

      <ConfirmDialog
        open={confirmOpen}
        onOpenChange={setConfirmOpen}
        title="¿Eliminar invitación?"
        description={`${invitation.email} ya no va a poder sumarse con este email.`}
        onConfirm={async () => {
          const res = await deleteInvitation({ id: invitation.id });
          if (!res.ok) {
            toast.error(res.error);
          } else {
            toast.success("Invitación eliminada.");
          }
          setConfirmOpen(false);
        }}
      />
    </li>
  );
}

/* ── Dialog de invitar ── */

function InviteDialog({
  open,
  onOpenChange,
  agencyName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agencyName: string;
}) {
  const [email, setEmail] = React.useState("");
  const [role, setRole] = React.useState<MemberRole>("vendedor");
  const [displayName, setDisplayName] = React.useState("");
  const [commission, setCommission] = React.useState("0");
  const [loading, setLoading] = React.useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(commission.replace(",", "."));
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error("La comisión tiene que estar entre 0 y 100.");
      return;
    }
    setLoading(true);
    const res = await createInvitation({
      email: email.trim(),
      role,
      display_name: displayName.trim() || undefined,
      commission_pct: pct,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteMessage(agencyName));
      toast.success("Invitación creada. Copiamos el mensaje para que se lo pases.");
    } catch {
      toast.success("Invitación creada. Copiá el mensaje desde la fila para pasárselo.");
    }
    setEmail("");
    setDisplayName("");
    setCommission("0");
    setRole("vendedor");
    onOpenChange(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !loading && onOpenChange(o)}>
      <DialogContent
        title="Invitar al equipo"
        description="Cuando se registre con ese email, entra solo."
        size="md"
      >
        <form onSubmit={submit} className="space-y-4">
          <div>
            <Label htmlFor="inv-email">Email *</Label>
            <Input
              id="inv-email"
              type="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="vendedor@tuagencia.com"
              autoFocus
            />
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="inv-role">Rol</Label>
              <Select id="inv-role" value={role} onChange={(e) => setRole(e.target.value as MemberRole)}>
                {ROLE_OPTIONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="inv-comm">Comisión %</Label>
              <div className="relative">
                <Input
                  id="inv-comm"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  inputMode="decimal"
                  className="pr-7 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                  %
                </span>
              </div>
            </div>
          </div>
          <div>
            <Label htmlFor="inv-name">Nombre para mostrar</Label>
            <Input
              id="inv-name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Ej: Caro Méndez"
              maxLength={80}
            />
          </div>
          <div className="flex justify-end gap-2 pt-1">
            <Button type="button" variant="secondary" onClick={() => onOpenChange(false)} disabled={loading}>
              Cancelar
            </Button>
            <Button type="submit" loading={loading}>
              <UserPlus />
              Invitar
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
