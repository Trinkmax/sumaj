"use client";

import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowRight,
  Calendar,
  ClipboardCheck,
  Copy,
  Loader2,
  MessageCircle,
  MoreHorizontal,
  Pencil,
  PlaneTakeoff,
  ReceiptText,
  RotateCcw,
  Share2,
  Target,
  User,
  XCircle,
  type LucideIcon,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
} from "@/components/ui/dropdown";
import { Avatar } from "@/components/ui/avatar";
import { markFileReviewed, updateFile, updateFileStatus } from "@/lib/actions/files";
import { getLeadConversationId } from "@/lib/actions/leads";
import { FILE_STATUSES, waLink } from "@/lib/domain";
import { fmtDate, fmtDateFull, fmtRelative, nightsBetween } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { Enums, FileStatus, ServiceType } from "@/lib/types";
import { departureBadge } from "./helpers";
import type { FileDetail, ServiceRow, TravelerRow } from "./types";

/** camino feliz del expediente; "cancelado" queda fuera del stepper */
const STEPPER_STATUSES: FileStatus[] = ["vendido", "pagado", "en_curso", "finalizado"];

/**
 * Estado local optimista que se resincroniza cuando el server manda otro valor
 * (revalidatePath). Se ajusta en el render —el patrón que recomienda React—
 * en vez de un useEffect: no hay pintado intermedio con el valor viejo.
 */
function useServerState<T>(serverValue: T) {
  const [value, setValue] = React.useState<T>(serverValue);
  const [seen, setSeen] = React.useState<T>(serverValue);
  if (seen !== serverValue) {
    setSeen(serverValue);
    setValue(serverValue);
  }
  return [value, setValue] as const;
}

export function FileHeader({
  file,
  services,
  travelers,
  agencyName,
  quoteCode,
  conversationId,
  isAdmin,
}: {
  file: FileDetail;
  services: ServiceRow[];
  travelers: TravelerRow[];
  agencyName: string;
  quoteCode?: string | null;
  conversationId?: string | null;
  isAdmin: boolean;
}) {
  const [datesOpen, setDatesOpen] = React.useState(false);
  const [cancelOpen, setCancelOpen] = React.useState(false);

  /* estado del file, optimista y compartido por stepper + menú */
  const [status, setStatus] = useServerState<FileStatus>(file.status);

  /* revisión de la venta (las que nacen del pipeline entran pendientes) */
  const [review, setReview] = useServerState<Enums<"file_review_status">>(file.review_status);
  const [reviewLoading, setReviewLoading] = React.useState(false);

  const setReviewed = async (reviewed: boolean) => {
    if (reviewLoading) return;
    setReviewLoading(true);
    const res = await markFileReviewed({ fileId: file.id, reviewed });
    setReviewLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    setReview(reviewed ? "revisado" : "pendiente");
    toast.success(
      reviewed ? `Venta ${file.code} revisada` : "La venta volvió a revisión",
    );
  };

  const changeStatus = async (next: FileStatus) => {
    if (next === status) return;
    const prev = status;
    setStatus(next);
    const res = await updateFileStatus({ fileId: file.id, status: next });
    if (!res.ok) {
      setStatus(prev);
      toast.error(res.error);
      return;
    }
    toast.success(
      next === "cancelado"
        ? `El file ${file.code} quedó cancelado`
        : `El file pasó a ${FILE_STATUSES[next].label}`,
    );
  };

  const cancelled = status === "cancelado";
  const badge = departureBadge(file.departure_date);
  const nights = nightsBetween(file.departure_date, file.return_date);

  return (
    <div className="animate-slide-up px-4 pt-4 md:px-6">
      {review === "pendiente" && (
        <div className="mb-4 flex flex-wrap items-center gap-3 rounded-2xl border border-tone-amber-line bg-tone-amber-soft px-3.5 py-3 animate-fade-in">
          <div className="flex min-w-56 flex-1 items-start gap-2.5">
            <ClipboardCheck
              className="mt-0.5 size-4.5 shrink-0 text-tone-amber-text"
              strokeWidth={2}
            />
            <div className="min-w-0 text-tone-amber-text">
              <p className="text-sm font-semibold">En revisión</p>
              <p className="mt-0.5 text-[13px] leading-snug">
                {isAdmin
                  ? "Esta venta se creó desde el pipeline. Chequeá servicios, montos y comisión antes de darla por buena."
                  : "Esta venta se creó desde el pipeline. Un admin tiene que chequear servicios, montos y comisión antes de darla por buena."}
              </p>
            </div>
          </div>
          {isAdmin && (
            <Button
              onClick={() => setReviewed(true)}
              loading={reviewLoading}
              className="shrink-0 max-md:w-full"
            >
              <ClipboardCheck /> Marcar como revisada
            </Button>
          )}
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-sand-soft px-2 py-0.5 font-mono text-sm font-bold tracking-wide text-ink">
              {file.code}
            </span>
            {badge && !cancelled && (
              <span className="inline-flex animate-pop items-center gap-1 rounded-full border border-tone-sky-line bg-tone-sky-soft px-2.5 py-0.5 text-[11px] font-semibold text-tone-sky-text">
                <PlaneTakeoff className="size-3" strokeWidth={2} />
                {badge}
              </span>
            )}
          </div>

          <h1 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[32px]">
            {file.destination}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-soft">
            <button
              type="button"
              onClick={() => setDatesOpen(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg transition-colors hover:text-ink tap-highlight-none"
            >
              <Calendar className="size-4 text-ink-faint" />
              {file.departure_date ? (
                <span className="inline-flex items-center gap-1.5 tabular-nums">
                  {fmtDate(file.departure_date)}
                  {file.return_date && (
                    <>
                      <ArrowRight className="size-3.5 text-ink-faint" />
                      {fmtDate(file.return_date)}
                    </>
                  )}
                  {nights != null && (
                    <span className="text-ink-faint">· {nights} noches</span>
                  )}
                </span>
              ) : (
                <span className="text-ink-faint">Fechas a definir</span>
              )}
              <Pencil className="size-3.5 text-ink-faint" />
            </button>
            {file.seller && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={file.seller.display_name} className="size-5 text-[9px]" />
                {file.seller.display_name}
              </span>
            )}
            {review === "revisado" && file.reviewed_at && (
              <span className="inline-flex items-center gap-1.5 text-[13px] text-ink-faint">
                <ClipboardCheck className="size-3.5" strokeWidth={2} />
                {file.reviewed_by_name
                  ? `Revisada por ${file.reviewed_by_name} · ${fmtRelative(file.reviewed_at)}`
                  : `Revisada ${fmtRelative(file.reviewed_at)}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <ShareVoucherButton
            file={file}
            services={services}
            travelers={travelers}
            agencyName={agencyName}
          />
          <Dropdown>
            <DropdownTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Más opciones del file">
                <MoreHorizontal />
              </Button>
            </DropdownTrigger>
            <DropdownContent align="end">
              <DropdownItem onSelect={() => setDatesOpen(true)}>
                <Calendar /> Editar fechas
              </DropdownItem>
              {isAdmin && review === "revisado" && (
                <DropdownItem onSelect={() => setReviewed(false)}>
                  <ClipboardCheck /> Volver a revisión
                </DropdownItem>
              )}
              {cancelled ? (
                <DropdownItem onSelect={() => changeStatus("vendido")}>
                  <RotateCcw /> Reactivar file
                </DropdownItem>
              ) : (
                <DropdownItem destructive onSelect={() => setCancelOpen(true)}>
                  <XCircle /> Cancelar file
                </DropdownItem>
              )}
            </DropdownContent>
          </Dropdown>
        </div>
      </div>

      {/* stepper de estado del expediente */}
      <StatusStepper status={status} cancelled={cancelled} onChange={changeStatus} />

      {cancelled && (
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl border border-tone-red-line bg-tone-red-soft px-3.5 py-2.5 animate-fade-in">
          <span className="inline-flex items-center gap-2 text-sm font-medium text-tone-red-text">
            <XCircle className="size-4" strokeWidth={2} />
            File cancelado
          </span>
          <Button variant="secondary" size="sm" onClick={() => changeStatus("vendido")}>
            <RotateCcw /> Reactivar
          </Button>
        </div>
      )}

      {/* navegación cruzada: el expediente conecta todo */}
      <div className="mt-4 flex flex-wrap items-center gap-2 stagger-children">
        {file.contact && (
          <NavChip href={`/clientes/${file.contact.id}`} icon={User} label={file.contact.full_name} />
        )}
        {file.contact && (
          <ChatChip contactId={file.contact.id} conversationId={conversationId ?? null} />
        )}
        {file.quote_id && (
          <NavChip
            href={`/presupuestos/${file.quote_id}`}
            icon={ReceiptText}
            label={quoteCode ? `Presupuesto ${quoteCode}` : "Presupuesto de origen"}
          />
        )}
        {file.lead_id && (
          <NavChip href={`/crm/${file.lead_id}`} icon={Target} label="Lead de origen" />
        )}
      </div>

      {datesOpen && (
        <DatesDialog file={file} open={datesOpen} onOpenChange={setDatesOpen} />
      )}

      {cancelOpen && (
        <Dialog open onOpenChange={(o) => !o && setCancelOpen(false)}>
          <DialogContent
            title="Cancelar file"
            description={`${file.code} · ${file.destination}`}
          >
            <div className="space-y-4">
              <p className="text-sm text-ink-soft">
                El file queda como cancelado y sale de las ventas activas. Los cobros
                registrados no se tocan; si hace falta devolver plata, resolvelo desde Caja.
              </p>
              <div className="flex justify-end gap-2">
                <Button variant="secondary" onClick={() => setCancelOpen(false)}>
                  No, volver
                </Button>
                <Button
                  variant="danger"
                  onClick={() => {
                    setCancelOpen(false);
                    changeStatus("cancelado");
                  }}
                >
                  <XCircle /> Cancelar file
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      )}
    </div>
  );
}

/* ───────────────────────── stepper de estado ───────────────────────── */

function StatusStepper({
  status,
  cancelled,
  onChange,
}: {
  status: FileStatus;
  cancelled: boolean;
  onChange: (next: FileStatus) => void;
}) {
  const currentIdx = STEPPER_STATUSES.indexOf(status);

  return (
    <ol
      className={cn(
        "mt-5 flex w-full max-w-lg items-start transition-opacity duration-200",
        cancelled && "pointer-events-none opacity-40",
      )}
      aria-label="Estado del file"
    >
      {STEPPER_STATUSES.map((key, i) => {
        const meta = FILE_STATUSES[key];
        const Icon = meta.icon;
        const reached = currentIdx >= i;
        const isCurrent = currentIdx === i;
        return (
          <li key={key} className={cn("flex items-start", i > 0 && "min-w-0 flex-1")}>
            {i > 0 && (
              <span
                aria-hidden
                className={cn(
                  "mx-1 mt-[17px] h-0.5 min-w-3 flex-1 rounded-full transition-colors duration-300 md:mx-1.5",
                  reached ? "bg-ink" : "bg-line-strong",
                )}
              />
            )}
            <button
              type="button"
              onClick={() => onChange(key)}
              disabled={cancelled}
              aria-current={isCurrent ? "step" : undefined}
              title={`Marcar como ${meta.label}`}
              className="group flex min-w-11 shrink-0 flex-col items-center gap-1.5 tap-highlight-none"
            >
              <span
                className={cn(
                  "flex size-9 items-center justify-center rounded-full border transition-all duration-200 group-active:scale-95",
                  reached
                    ? "border-ink bg-ink text-cream shadow-sm"
                    : "border-line bg-paper text-ink-faint group-hover:border-line-strong group-hover:text-ink-soft",
                  isCurrent && "ring-2 ring-brand-tint-line ring-offset-2 ring-offset-cream",
                )}
              >
                <Icon className="size-4" strokeWidth={1.9} />
              </span>
              <span
                className={cn(
                  "text-[11px] leading-none transition-colors",
                  isCurrent
                    ? "font-semibold text-ink"
                    : reached
                      ? "font-medium text-ink-soft"
                      : "text-ink-faint",
                )}
              >
                {meta.label}
              </span>
            </button>
          </li>
        );
      })}
    </ol>
  );
}

/* ───────────────────────── chips de navegación ───────────────────────── */

const CHIP_CLASS =
  "inline-flex min-h-10 items-center gap-1.5 rounded-full border border-line bg-paper px-3.5 text-[13px] font-medium text-ink-soft transition-all tap-highlight-none hover:border-line-strong hover:text-ink hover:shadow-sm active:scale-[0.98]";

function NavChip({
  href,
  icon: Icon,
  label,
}: {
  href: string;
  icon: LucideIcon;
  label: string;
}) {
  return (
    <Link href={href} className={CHIP_CLASS}>
      <Icon className="size-3.5 text-ink-faint" strokeWidth={2} />
      <span className="max-w-44 truncate">{label}</span>
    </Link>
  );
}

function ChatChip({
  contactId,
  conversationId,
}: {
  contactId: string;
  conversationId: string | null;
}) {
  const router = useRouter();
  const [loading, setLoading] = React.useState(false);

  const open = async () => {
    if (conversationId) {
      router.push(`/crm?vista=chats&c=${conversationId}`);
      return;
    }
    setLoading(true);
    const res = await getLeadConversationId({ contactId });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    router.push(`/crm?vista=chats&c=${res.data.conversationId}`);
  };

  return (
    <button type="button" onClick={open} disabled={loading} className={CHIP_CLASS}>
      {loading ? (
        <Loader2 className="size-3.5 animate-spin text-ink-faint" />
      ) : (
        <MessageCircle className="size-3.5 text-ink-faint" strokeWidth={2} />
      )}
      Chat
    </button>
  );
}

/* ───────────────────────── fechas ───────────────────────── */

function DatesDialog({
  file,
  open,
  onOpenChange,
}: {
  file: FileDetail;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [departure, setDeparture] = React.useState(file.departure_date ?? "");
  const [ret, setRet] = React.useState(file.return_date ?? "");
  const [loading, setLoading] = React.useState(false);

  const save = async () => {
    setLoading(true);
    const res = await updateFile({
      fileId: file.id,
      departureDate: departure || null,
      returnDate: ret || null,
    });
    setLoading(false);
    if (!res.ok) {
      toast.error(res.error);
      return;
    }
    toast.success("Fechas actualizadas");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="Fechas del viaje" description={`${file.code} · ${file.destination}`}>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="fd-dep">Salida</Label>
              <Input
                id="fd-dep"
                type="date"
                value={departure}
                onChange={(e) => setDeparture(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="fd-ret">Regreso</Label>
              <Input
                id="fd-ret"
                type="date"
                value={ret}
                min={departure || undefined}
                onChange={(e) => setRet(e.target.value)}
              />
            </div>
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => onOpenChange(false)}>
              Cancelar
            </Button>
            <Button onClick={save} loading={loading}>
              Guardar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/* ───────────────────────── voucher ─────────────────────────
   El texto va AL CLIENTE por WhatsApp: acá los emojis están permitidos
   (única excepción a la regla; la UI interna usa solo iconos lucide). */

const VOUCHER_EMOJI: Record<ServiceType, string> = {
  aereo: "✈️",
  hotel: "🏨",
  paquete: "🧳",
  excursion: "🚌",
  traslado: "🚐",
  asistencia: "🛡️",
  circuito: "🗺️",
  crucero: "🛳️",
  otro: "📎",
};

function buildVoucherText(
  file: FileDetail,
  services: ServiceRow[],
  travelers: TravelerRow[],
  agencyName: string,
): string {
  const lines: string[] = [];
  lines.push(`🧾 *Confirmación de viaje — ${file.code}*`);
  lines.push(`📍 ${file.destination}`);
  if (file.departure_date) {
    lines.push(
      `🗓️ Salida: ${fmtDateFull(file.departure_date)}${
        file.return_date ? ` · Regreso: ${fmtDateFull(file.return_date)}` : ""
      }`,
    );
  }

  if (services.length > 0) {
    lines.push("");
    lines.push("*Servicios:*");
    for (const s of services) {
      let line = `${VOUCHER_EMOJI[s.type]} ${s.description}`;
      if (s.reservation_code) line += ` — reserva ${s.reservation_code}`;
      if (s.date_from) {
        line += ` (${fmtDateFull(s.date_from)}${s.date_to ? ` al ${fmtDateFull(s.date_to)}` : ""})`;
      }
      lines.push(line);
    }
  }

  if (travelers.length > 0) {
    lines.push("");
    lines.push("*Pasajeros:*");
    for (const t of travelers) {
      let line = `• ${t.full_name}`;
      if (t.document_number) {
        const doc = t.document_type ? t.document_type.toUpperCase() : "Doc";
        line += ` — ${doc} ${t.document_number}`;
      }
      lines.push(line);
    }
  }

  lines.push("");
  lines.push(`¡Gracias por viajar con ${agencyName}! ✨`);
  return lines.join("\n");
}

function ShareVoucherButton({
  file,
  services,
  travelers,
  agencyName,
}: {
  file: FileDetail;
  services: ServiceRow[];
  travelers: TravelerRow[];
  agencyName: string;
}) {
  const text = React.useMemo(
    () => buildVoucherText(file, services, travelers, agencyName),
    [file, services, travelers, agencyName],
  );

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Confirmación copiada");
    } catch {
      toast.error("No se pudo copiar. Probá de nuevo.");
    }
  };

  const phone = file.contact?.phone ?? null;

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <Button variant="secondary">
          <Share2 /> Compartir confirmación
        </Button>
      </DropdownTrigger>
      <DropdownContent align="end">
        {phone && (
          <DropdownItem
            onSelect={() => window.open(waLink(phone, text), "_blank", "noopener")}
          >
            <WhatsAppIcon /> Enviar por WhatsApp
          </DropdownItem>
        )}
        <DropdownItem onSelect={copy}>
          <Copy /> Copiar texto
        </DropdownItem>
      </DropdownContent>
    </Dropdown>
  );
}

function WhatsAppIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 !text-wa-accent" aria-hidden>
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38c1.45.79 3.08 1.2 4.7 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.94-.4-4.2-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.7-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}
