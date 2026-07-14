import Link from "next/link";
import {
  Cake,
  ChevronRight,
  Funnel,
  IdCard,
  MessageCircle,
  PlaneTakeoff,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";
import { FunnelBars, type FunnelRow } from "@/components/inicio/funnel-bars";

export type { FunnelRow };

export type DepartureItem = {
  id: string;
  contactName: string;
  destination: string;
  date: string;
  days: number;
  balance: number;
  currency: string;
};

export type DocumentItem = {
  id: string;
  travelerName: string;
  docLabel: string;
  expiry: string;
  daysLeft: number;
  contactId: string;
};

export type BirthdayItem = {
  id: string;
  name: string;
  dateLabel: string;
  isToday: boolean;
  waHref: string | null;
};

/**
 * Radar: 2×2 compacto (4 en fila en pantallas grandes para entrar en una
 * sola pantalla). Filas chicas, todo linkea.
 */
export function RadarSection({
  departures,
  documents,
  birthdays,
  funnel,
}: {
  departures: DepartureItem[];
  documents: DocumentItem[];
  birthdays: BirthdayItem[];
  funnel: FunnelRow[];
}) {
  return (
    <section>
      <div className="grid items-stretch gap-2 sm:grid-cols-2 md:gap-3 xl:grid-cols-4 stagger-children">
        {/* próximas salidas */}
        <RadarCard icon={PlaneTakeoff} tone="bg-tone-sky-soft text-tone-sky-text" title="Próximas salidas">
          {departures.length === 0 ? (
            <RadarEmpty text="Sin salidas en los próximos 30 días." />
          ) : (
            <div className="divide-y divide-line">
              {departures.slice(0, 3).map((d) => (
                <Link
                  key={d.id}
                  href={`/files/${d.id}`}
                  className="flex min-h-11 items-center gap-2 py-1.5 transition-colors hover:bg-sand-soft/50 active:bg-sand-soft tap-highlight-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {d.contactName}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {d.destination} · {fmtDate(d.date)}
                    </p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5">
                    <Badge color={d.days < 7 ? "red" : undefined}>
                      {d.days === 0 ? "sale hoy" : d.days === 1 ? "mañana" : `en ${d.days} días`}
                    </Badge>
                    {d.balance > 0 && (
                      <span className="text-[10px] font-semibold tabular-nums text-tone-amber-text">
                        debe {fmtMoney(d.balance, d.currency)}
                      </span>
                    )}
                  </div>
                </Link>
              ))}
              {departures.length > 3 && (
                <Link
                  href="/files"
                  className="block py-2 text-[11px] font-medium text-brand-text transition-colors hover:text-brand-600 tap-highlight-none"
                >
                  Ver todas las salidas
                </Link>
              )}
            </div>
          )}
        </RadarCard>

        {/* documentos por vencer */}
        <RadarCard icon={IdCard} tone="bg-tone-violet-soft text-tone-violet-text" title="Documentos">
          {documents.length === 0 ? (
            <RadarEmpty text="Toda la documentación al día. Nada por vencer en 90 días." />
          ) : (
            <div className="divide-y divide-line">
              {documents.slice(0, 3).map((doc) => (
                <Link
                  key={doc.id}
                  href={`/clientes/${doc.contactId}`}
                  className="flex min-h-11 items-center gap-2 py-1.5 transition-colors hover:bg-sand-soft/50 active:bg-sand-soft tap-highlight-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-medium text-ink">
                      {doc.travelerName}
                    </p>
                    <p className="truncate text-[11px] text-ink-soft">{doc.docLabel}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-[11px] font-medium tabular-nums",
                      doc.daysLeft < 30 ? "text-tone-red-text" : "text-ink-faint",
                    )}
                  >
                    {doc.daysLeft < 0
                      ? `venció ${fmtDate(doc.expiry)}`
                      : `vence ${fmtDate(doc.expiry)}`}
                  </span>
                </Link>
              ))}
              {documents.length > 3 && (
                <Link
                  href="/clientes"
                  className="block py-2 text-[11px] font-medium text-brand-text transition-colors hover:text-brand-600 tap-highlight-none"
                >
                  Ver todos los documentos
                </Link>
              )}
            </div>
          )}
        </RadarCard>

        {/* cumpleaños del mes */}
        <RadarCard icon={Cake} tone="bg-tone-rose-soft text-tone-rose-text" title="Cumpleaños">
          {birthdays.length === 0 ? (
            <RadarEmpty text="Nadie cumple años este mes." />
          ) : (
            <div className="divide-y divide-line">
              {birthdays.slice(0, 3).map((b) => (
                <div key={b.id} className="flex min-h-11 items-center gap-2 py-1.5">
                  <Link
                    href={`/clientes/${b.id}`}
                    className="min-w-0 flex-1 transition-colors hover:text-brand-text tap-highlight-none"
                  >
                    <p className="truncate text-[13px] font-medium text-ink">{b.name}</p>
                    <p className="truncate text-[11px] text-ink-soft">
                      {b.dateLabel}
                      {b.isToday && (
                        <span className="ml-1.5 font-semibold text-brand-text">
                          ¡es hoy!
                        </span>
                      )}
                    </p>
                  </Link>
                  {b.waHref && (
                    <a
                      href={b.waHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Saludar a ${b.name} por WhatsApp`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-wa-accent text-white shadow-sm transition-all hover:opacity-90 active:scale-95 tap-highlight-none"
                    >
                      <MessageCircle className="size-4" strokeWidth={2} />
                    </a>
                  )}
                </div>
              ))}
              {birthdays.length > 3 && (
                <p className="pt-2 text-[11px] text-ink-faint">
                  y {birthdays.length - 3} más este mes
                </p>
              )}
            </div>
          )}
        </RadarCard>

        {/* embudo mini */}
        <RadarCard
          icon={Funnel}
          tone="bg-brand-tint text-brand-text"
          title="Embudo"
          action={
            <Link
              href="/crm"
              className="inline-flex items-center gap-0.5 text-[11px] font-medium text-brand-text transition-colors hover:text-brand-600 tap-highlight-none"
            >
              Pipeline
              <ChevronRight className="size-3" strokeWidth={2} />
            </Link>
          }
        >
          <div className="pt-1">
            <FunnelBars rows={funnel} />
          </div>
        </RadarCard>
      </div>
    </section>
  );
}

function RadarCard({
  icon: Icon,
  tone,
  title,
  action,
  children,
}: {
  icon: LucideIcon;
  /** clases del círculo tonal del icono */
  tone: string;
  title: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex h-full min-h-[176px] flex-col p-3.5">
      <div className="flex items-center gap-2">
        <span
          className={cn(
            "flex size-6 shrink-0 items-center justify-center rounded-full",
            tone,
          )}
        >
          <Icon className="size-3.5" strokeWidth={1.9} />
        </span>
        <p className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink-soft">
          {title}
        </p>
        {action}
      </div>
      <div className="mt-1.5 min-h-0 flex-1">{children}</div>
    </div>
  );
}

function RadarEmpty({ text }: { text: string }) {
  return (
    <div className="flex h-full items-center justify-center px-2 py-3 text-center">
      <p className="max-w-[24ch] text-xs leading-relaxed text-ink-faint">{text}</p>
    </div>
  );
}
