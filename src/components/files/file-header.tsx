"use client";

import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Calendar,
  Check,
  ChevronDown,
  Copy,
  Pencil,
  Share2,
  User,
} from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import {
  Dropdown,
  DropdownTrigger,
  DropdownContent,
  DropdownItem,
  DropdownLabel,
} from "@/components/ui/dropdown";
import { Avatar } from "@/components/ui/avatar";
import { updateFile, updateFileStatus } from "@/lib/actions/files";
import { FILE_STATUSES, SERVICE_TYPES, waLink } from "@/lib/domain";
import { fmtDate, fmtDateFull, nightsBetween } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { FileStatus } from "@/lib/types";
import { departureBadge } from "./helpers";
import type { FileDetail, ServiceRow, TravelerRow } from "./types";

const STATUS_KEYS = Object.keys(FILE_STATUSES) as FileStatus[];

export function FileHeader({
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
  const [datesOpen, setDatesOpen] = React.useState(false);
  const badge = departureBadge(file.departure_date);
  const nights = nightsBetween(file.departure_date, file.return_date);

  return (
    <div className="animate-slide-up px-4 pt-4 md:px-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-lg bg-sand-soft px-2 py-0.5 font-mono text-sm font-bold tracking-wide text-ink">
              {file.code}
            </span>
            <StatusSelect fileId={file.id} status={file.status} />
            {badge && (
              <span className="animate-pop rounded-full border border-sky-200 bg-sky-50 px-2 py-0.5 text-[11px] font-medium text-sky-700">
                {badge}
              </span>
            )}
          </div>

          <h1 className="mt-2 font-display text-[26px] font-semibold leading-tight tracking-tight text-ink md:text-[32px]">
            {file.destination}
          </h1>

          <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-ink-soft">
            {file.contact && (
              <Link
                href={`/clientes/${file.contact.id}`}
                className="inline-flex items-center gap-1.5 font-medium text-ink transition-colors hover:text-brand-600 tap-highlight-none"
              >
                <User className="size-4 text-ink-faint" />
                {file.contact.full_name}
              </Link>
            )}
            {file.seller && (
              <span className="inline-flex items-center gap-1.5">
                <Avatar name={file.seller.display_name} className="size-5 text-[9px]" />
                {file.seller.display_name}
              </span>
            )}
            <button
              type="button"
              onClick={() => setDatesOpen(true)}
              className="inline-flex min-h-8 items-center gap-1.5 rounded-lg transition-colors hover:text-ink tap-highlight-none"
            >
              <Calendar className="size-4 text-ink-faint" />
              {file.departure_date ? (
                <>
                  {fmtDate(file.departure_date)}
                  {file.return_date && ` → ${fmtDate(file.return_date)}`}
                  {nights != null && (
                    <span className="text-ink-faint">· {nights} noches</span>
                  )}
                </>
              ) : (
                <span className="text-ink-faint">Fechas a definir</span>
              )}
              <Pencil className="size-3.5 text-ink-faint" />
            </button>
          </div>
        </div>

        <ShareVoucherButton
          file={file}
          services={services}
          travelers={travelers}
          agencyName={agencyName}
        />
      </div>

      {datesOpen && (
        <DatesDialog file={file} open={datesOpen} onOpenChange={setDatesOpen} />
      )}
    </div>
  );
}

/* ───────────────────────── estado (optimista) ───────────────────────── */

function StatusSelect({ fileId, status }: { fileId: string; status: FileStatus }) {
  const [current, setCurrent] = React.useState(status);
  React.useEffect(() => setCurrent(status), [status]);
  const meta = FILE_STATUSES[current];

  const change = async (next: FileStatus) => {
    if (next === current) return;
    const prev = current;
    setCurrent(next);
    const res = await updateFileStatus({ fileId, status: next });
    if (!res.ok) {
      setCurrent(prev);
      toast.error(res.error);
      return;
    }
    toast.success(`Estado: ${FILE_STATUSES[next].label}`);
  };

  return (
    <Dropdown>
      <DropdownTrigger asChild>
        <button
          type="button"
          className={cn(
            "inline-flex min-h-7 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-medium transition-all tap-highlight-none active:scale-[0.98]",
            meta.chip,
          )}
        >
          {meta.label}
          <ChevronDown className="size-3.5 opacity-60" />
        </button>
      </DropdownTrigger>
      <DropdownContent align="start">
        <DropdownLabel>Estado del file</DropdownLabel>
        {STATUS_KEYS.map((key) => (
          <DropdownItem key={key} onSelect={() => change(key)}>
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium",
                FILE_STATUSES[key].chip,
              )}
            >
              {FILE_STATUSES[key].label}
            </span>
            {key === current && <Check className="ml-auto size-4 text-money-700" />}
          </DropdownItem>
        ))}
      </DropdownContent>
    </Dropdown>
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

/* ───────────────────────── voucher ───────────────────────── */

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
      const meta = SERVICE_TYPES[s.type];
      let line = `${meta.emoji} ${s.description}`;
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
      toast.success("Confirmación copiada ✅");
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
    <svg viewBox="0 0 24 24" fill="currentColor" className="size-4 !text-[#25d366]" aria-hidden>
      <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38c1.45.79 3.08 1.2 4.7 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.94-.4-4.2-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.7-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
    </svg>
  );
}
