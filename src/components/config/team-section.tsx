"use client";

import * as React from "react";
import { toast } from "sonner";
import {
  Briefcase,
  Check,
  ChevronDown,
  CircleCheckBig,
  Copy,
  Crown,
  Eye,
  EyeOff,
  KeyRound,
  Link2,
  Mail,
  MailPlus,
  RefreshCw,
  Trash2,
  UserPlus,
  UserRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import {
  Dropdown,
  DropdownContent,
  DropdownItem,
  DropdownTrigger,
} from "@/components/ui/dropdown";
import { Input, Label } from "@/components/ui/input";
import { ChoiceGrid, Switch, Tooltip } from "@/components/ui/misc";
import { ConfirmDialog } from "@/components/config/confirm-dialog";
import {
  createTeamMember,
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

const ROLE_CHOICES = [
  { value: "admin" as const, label: "Socio/Admin", icon: Crown, hint: "Ve y toca todo" },
  { value: "vendedor" as const, label: "Vendedor", icon: Briefcase, hint: "Ve toda la agencia" },
  { value: "freelance" as const, label: "Freelance", icon: UserRound, hint: "Solo lo suyo" },
];

function appUrl() {
  return (
    process.env.NEXT_PUBLIC_APP_URL ??
    (typeof window !== "undefined" ? window.location.origin : "")
  );
}

function loginUrl() {
  return `${appUrl()}/login`;
}

async function copyToClipboard(text: string, okMessage: string) {
  try {
    await navigator.clipboard.writeText(text);
    toast.success(okMessage);
  } catch {
    toast.error("No se pudo copiar. Copialo a mano.");
  }
}

/* Contraseña legible tipo "viaje-8f3k-2026": fácil de dictar por WhatsApp. */
const PWD_WORDS = ["viaje", "ruta", "vuelo", "valija", "brujula", "destino", "escala", "playa"];
const PWD_CHARS = "abcdefghijkmnpqrstuvwxyz23456789";

/** Enteros 0..max-1 con el generador criptográfico del browser (fallback a Math.random). */
function randomInts(count: number, max: number): number[] {
  const out: number[] = [];
  const c = typeof crypto !== "undefined" ? crypto : undefined;
  if (c?.getRandomValues) {
    const buf = new Uint32Array(count);
    c.getRandomValues(buf);
    for (let i = 0; i < count; i++) out.push(buf[i] % max);
    return out;
  }
  for (let i = 0; i < count; i++) out.push(Math.floor(Math.random() * max));
  return out;
}

function generatePassword() {
  const word = PWD_WORDS[randomInts(1, PWD_WORDS.length)[0]];
  const mid = randomInts(4, PWD_CHARS.length)
    .map((i) => PWD_CHARS[i])
    .join("");
  return `${word}-${mid}-${new Date().getFullYear()}`;
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
  const [createOpen, setCreateOpen] = React.useState(false);
  const activeCount = members.filter((m) => m.is_active).length;

  return (
    <div className="space-y-4">
      <section className="card overflow-hidden animate-slide-up">
        <div className="flex items-center justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold text-ink">Equipo</h2>
            <p className="text-sm text-ink-faint">
              {activeCount} {activeCount === 1 ? "activo" : "activos"} · el acceso lo creás vos y se
              lo pasás
            </p>
          </div>
          <Button
            onClick={() => setCreateOpen(true)}
            aria-label="Crear usuario"
            className="shrink-0"
          >
            <UserPlus />
            <span className="hidden sm:inline">Crear usuario</span>
          </Button>
        </div>
        <ul className="divide-y divide-line stagger-children">
          {members.map((m) => (
            <MemberRow key={m.id} member={m} isSelf={m.id === currentMemberId} />
          ))}
        </ul>
      </section>

      {invitations.length > 0 && (
        <section className="card p-5 animate-fade-in">
          <h2 className="font-display text-lg font-semibold text-ink">Invitaciones pendientes</h2>
          <p className="mt-0.5 text-sm text-ink-faint">
            Entran la primera vez con el email y la contraseña que les pasaste.
          </p>
          <ul className="mt-4 divide-y divide-line">
            {invitations.map((inv) => (
              <InvitationRow key={inv.id} invitation={inv} agencyName={agencyName} />
            ))}
          </ul>
        </section>
      )}

      <CreateUserDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        agencyName={agencyName}
      />
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
    copyToClipboard(
      `Tu acceso al sistema de ${agencyName}: entrá en ${loginUrl()} con ${invitation.email} y la contraseña que te pasé.`,
      "Mensaje copiado. Pasáselo por WhatsApp.",
    );
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
      <Tooltip content="Copiar mensaje de acceso">
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

/* ── Crear usuario: formulario + panel de acceso listo ── */

type CreatedAccess = {
  name: string;
  email: string;
  password: string;
  mode: "directo" | "invitacion";
  reusedAccount: boolean;
};

/* Texto que el admin pega en WhatsApp: es el único lugar donde SÍ van emojis
   (mensaje a una persona, no UI). */
function accessMessage(created: CreatedAccess, agencyName: string) {
  const firstName = created.name.trim().split(" ")[0] || created.name.trim();
  const lines = [
    `Hola ${firstName}, ya tenés tu acceso al sistema de ${agencyName}.`,
    "",
    `🔗 ${loginUrl()}`,
    `📧 ${created.email}`,
    created.reusedAccount
      ? "🔑 Entrás con la contraseña que ya usás en el sistema."
      : `🔑 ${created.password}`,
    "",
    created.reusedAccount
      ? "Cualquier cosa, escribime."
      : "Guardala y cambiala cuando quieras. Cualquier cosa, escribime.",
  ];
  return lines.join("\n");
}

function CreateUserDialog({
  open,
  onOpenChange,
  agencyName,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  agencyName: string;
}) {
  const [displayName, setDisplayName] = React.useState("");
  const [email, setEmail] = React.useState("");
  const [password, setPassword] = React.useState("");
  const [showPassword, setShowPassword] = React.useState(false);
  const [role, setRole] = React.useState<MemberRole>("vendedor");
  const [commission, setCommission] = React.useState("0");
  const [loading, setLoading] = React.useState(false);
  const [created, setCreated] = React.useState<CreatedAccess | null>(null);

  // al abrir: formulario limpio + contraseña sugerida (se genera en el cliente,
  // nunca en el render del server, para no romper la hidratación)
  React.useEffect(() => {
    if (!open) return;
    setDisplayName("");
    setEmail("");
    setShowPassword(false);
    setRole("vendedor");
    setCommission("0");
    setCreated(null);
    setPassword(generatePassword());
  }, [open]);

  function close() {
    onOpenChange(false);
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const pct = Number(commission.replace(",", "."));
    if (isNaN(pct) || pct < 0 || pct > 100) {
      toast.error("La comisión tiene que estar entre 0 y 100.");
      return;
    }
    setLoading(true);
    try {
      const res = await createTeamMember({
        email: email.trim(),
        password,
        displayName: displayName.trim(),
        role,
        commissionPct: pct,
      });
      if (!res.ok) {
        toast.error(res.error);
        return;
      }
      setCreated({
        name: displayName.trim(),
        email: email.trim().toLowerCase(),
        password,
        mode: res.data.mode,
        reusedAccount: res.data.reusedAccount,
      });
      toast.success(`${displayName.trim().split(" ")[0]} ya está en el equipo.`);
    } catch {
      toast.error("No se pudo crear el usuario. Revisá tu conexión y probá de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (loading) return;
        if (o) onOpenChange(true);
        else close();
      }}
    >
      <DialogContent
        title={created ? "Acceso listo" : "Crear usuario"}
        description={
          created
            ? "Pasáselo por WhatsApp y ya puede entrar."
            : "Le ponés email y contraseña, y le pasás el acceso vos."
        }
        size="md"
        // con la contraseña en pantalla no se cierra de un toque al costado:
        // no se vuelve a mostrar
        onInteractOutside={(e) => {
          if (created) e.preventDefault();
        }}
      >
        {created ? (
          <AccessPanel created={created} agencyName={agencyName} onDone={close} />
        ) : (
          <form onSubmit={submit} className="space-y-4">
            <div>
              <Label htmlFor="nu-name">Nombre</Label>
              <Input
                id="nu-name"
                required
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="Caro Méndez"
                maxLength={80}
                autoFocus
                className="h-11"
              />
            </div>

            <div>
              <Label htmlFor="nu-email">Email</Label>
              <Input
                id="nu-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="caro@tuagencia.com"
                autoComplete="off"
                autoCapitalize="none"
                spellCheck={false}
                className="h-11"
              />
            </div>

            <div>
              <div className="mb-1.5 flex items-center justify-between gap-2">
                <Label htmlFor="nu-pass" className="mb-0">
                  Contraseña
                </Label>
                <button
                  type="button"
                  onClick={() => {
                    setPassword(generatePassword());
                    setShowPassword(true);
                  }}
                  className="-mr-1 inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-brand-text transition-colors hover:bg-brand-tint tap-highlight-none active:scale-95"
                >
                  <RefreshCw className="size-3.5" strokeWidth={2} />
                  Generar otra
                </button>
              </div>
              <div className="relative">
                <Input
                  id="nu-pass"
                  type={showPassword ? "text" : "password"}
                  required
                  minLength={8}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Mínimo 8 caracteres"
                  autoComplete="new-password"
                  className="h-11 pr-[5.5rem] font-mono text-[13px]"
                />
                <div className="absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center">
                  <button
                    type="button"
                    onClick={() => setShowPassword((s) => !s)}
                    aria-label={showPassword ? "Ocultar contraseña" : "Mostrar contraseña"}
                    className="grid size-9 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
                  >
                    {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
                  </button>
                  <button
                    type="button"
                    onClick={() => copyToClipboard(password, "Contraseña copiada.")}
                    aria-label="Copiar contraseña"
                    className="grid size-9 place-items-center rounded-lg text-ink-faint transition-colors hover:bg-sand-soft hover:text-ink tap-highlight-none"
                  >
                    <Copy className="size-4" />
                  </button>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                Se la pasás vos: con esto entra al sistema.
              </p>
            </div>

            <div>
              <Label>Rol</Label>
              <ChoiceGrid
                options={ROLE_CHOICES}
                value={role}
                onChange={(r) => setRole(r)}
                columns={3}
              />
            </div>

            <div>
              <Label htmlFor="nu-comm">Comisión</Label>
              <div className="relative">
                <Input
                  id="nu-comm"
                  value={commission}
                  onChange={(e) => setCommission(e.target.value)}
                  inputMode="decimal"
                  className="h-11 pr-8 text-right tabular-nums"
                />
                <span className="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-ink-faint">
                  %
                </span>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                Lo que se lleva sobre la utilidad de cada file.
              </p>
            </div>

            <div className="flex flex-col-reverse gap-2 pt-1 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                size="lg"
                onClick={close}
                disabled={loading}
                className="sm:w-auto"
              >
                Cancelar
              </Button>
              <Button type="submit" size="lg" loading={loading} className="sm:w-auto">
                {!loading && <UserPlus />}
                Crear usuario
              </Button>
            </div>
          </form>
        )}
      </DialogContent>
    </Dialog>
  );
}

function AccessPanel({
  created,
  agencyName,
  onDone,
}: {
  created: CreatedAccess;
  agencyName: string;
  onDone: () => void;
}) {
  return (
    <div className="space-y-4 animate-fade-in">
      <div
        role="status"
        className="flex items-center gap-3 rounded-2xl border border-tone-emerald-line bg-tone-emerald-soft px-4 py-3"
      >
        <CircleCheckBig
          className="size-5 shrink-0 text-tone-emerald-text animate-check-pop"
          strokeWidth={1.9}
        />
        <p className="text-[13px] leading-snug text-tone-emerald-text">
          <span className="font-medium">{created.name}</span> ya es parte del equipo.
        </p>
      </div>

      <div className="overflow-hidden rounded-2xl border border-line bg-sand-soft/60">
        <CredRow icon={Link2} label="Link" value={loginUrl()} copyLabel="Link copiado." />
        <CredRow icon={Mail} label="Email" value={created.email} copyLabel="Email copiado." />
        {created.reusedAccount ? (
          <div className="flex items-center gap-3 border-t border-line px-4 py-3">
            <KeyRound className="size-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
            <div className="min-w-0">
              <p className="text-[11px] uppercase tracking-wide text-ink-faint">Contraseña</p>
              <p className="text-[13px] text-ink-soft">
                Ese email ya tenía cuenta: entra con la contraseña de siempre.
              </p>
            </div>
          </div>
        ) : (
          <CredRow
            icon={KeyRound}
            label="Contraseña"
            value={created.password}
            copyLabel="Contraseña copiada."
            mono
          />
        )}
      </div>

      {!created.reusedAccount && (
        <p className="text-[13px] leading-snug text-ink-soft">
          {created.mode === "invitacion"
            ? `La primera vez entra sola con ese email y esa contraseña, y queda dentro de ${agencyName}. `
            : ""}
          Copiá la contraseña ahora: después no se vuelve a mostrar.
        </p>
      )}

      <div className="space-y-2 pt-1">
        <Button
          size="lg"
          className="w-full"
          onClick={() =>
            copyToClipboard(
              accessMessage(created, agencyName),
              "Acceso copiado. Pegalo en el WhatsApp.",
            )
          }
        >
          <Copy />
          Copiar acceso
        </Button>
        <Button variant="secondary" size="lg" className="w-full" onClick={onDone}>
          Listo
        </Button>
      </div>
    </div>
  );
}

function CredRow({
  icon: Icon,
  label,
  value,
  copyLabel,
  mono,
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  copyLabel: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 border-t border-line px-4 py-2.5 first:border-t-0">
      <Icon className="size-4 shrink-0 text-ink-faint" strokeWidth={1.75} />
      <div className="min-w-0 flex-1">
        <p className="text-[11px] uppercase tracking-wide text-ink-faint">{label}</p>
        <p className={cn("truncate text-[13px] text-ink", mono && "font-mono font-medium")}>
          {value}
        </p>
      </div>
      <button
        type="button"
        onClick={() => copyToClipboard(value, copyLabel)}
        aria-label={`Copiar ${label.toLowerCase()}`}
        className="shrink-0 rounded-lg p-2.5 text-ink-faint transition-colors hover:bg-paper hover:text-ink tap-highlight-none active:scale-95"
      >
        <Copy className="size-4" />
      </button>
    </div>
  );
}
