import Link from "next/link";
import { MessageCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { fmtDate, fmtMoney } from "@/lib/format";
import { Badge } from "@/components/ui/badge";

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

export type FunnelRow = {
  key: string;
  label: string;
  count: number;
  dot: string;
  bar: string;
};

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
  const funnelMax = Math.max(...funnel.map((f) => f.count), 1);

  return (
    <section className="animate-fade-in">
      <h2 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-ink-faint">
        Radar
      </h2>

      <div className="mt-3 grid gap-3 md:grid-cols-2">
        {/* próximas salidas */}
        <RadarCard emoji="✈️" title="Próximas salidas">
          {departures.length === 0 ? (
            <RadarEmpty text="Sin salidas en los próximos 30 días." />
          ) : (
            <div className="divide-y divide-line">
              {departures.map((d) => (
                <Link
                  key={d.id}
                  href={`/files/${d.id}`}
                  className="flex min-h-14 items-center gap-3 py-2.5 transition-colors hover:bg-sand-soft/50 tap-highlight-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{d.contactName}</p>
                    <p className="truncate text-[13px] text-ink-soft">
                      {d.destination} · {fmtDate(d.date)}
                    </p>
                    {d.balance > 0 && (
                      <p className="text-xs font-medium text-amber-700">
                        ⚠️ debe {fmtMoney(d.balance, d.currency)}
                      </p>
                    )}
                  </div>
                  <Badge color={d.days < 7 ? "red" : undefined} className="shrink-0">
                    {d.days === 0 ? "sale hoy" : d.days === 1 ? "mañana" : `en ${d.days} días`}
                  </Badge>
                </Link>
              ))}
            </div>
          )}
        </RadarCard>

        {/* documentos por vencer */}
        <RadarCard emoji="🛂" title="Documentos por vencer">
          {documents.length === 0 ? (
            <RadarEmpty text="Toda la documentación al día. Nada por vencer en 90 días." />
          ) : (
            <div className="divide-y divide-line">
              {documents.map((doc) => (
                <Link
                  key={doc.id}
                  href={`/clientes/${doc.contactId}`}
                  className="flex min-h-14 items-center gap-3 py-2.5 transition-colors hover:bg-sand-soft/50 tap-highlight-none"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{doc.travelerName}</p>
                    <p className="truncate text-[13px] text-ink-soft">{doc.docLabel}</p>
                  </div>
                  <span
                    className={cn(
                      "shrink-0 text-xs font-medium tabular-nums",
                      doc.daysLeft < 30 ? "text-red-600" : "text-ink-faint",
                    )}
                  >
                    {doc.daysLeft < 0
                      ? `venció ${fmtDate(doc.expiry)}`
                      : `vence ${fmtDate(doc.expiry)}`}
                  </span>
                </Link>
              ))}
            </div>
          )}
        </RadarCard>

        {/* cumpleaños del mes */}
        <RadarCard emoji="🎂" title="Cumpleaños del mes">
          {birthdays.length === 0 ? (
            <RadarEmpty text="Nadie cumple años este mes." />
          ) : (
            <div className="divide-y divide-line">
              {birthdays.map((b) => (
                <div key={b.id} className="flex min-h-12 items-center gap-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">
                      {b.name}
                      <span className="font-normal text-ink-faint"> — {b.dateLabel}</span>
                      {b.isToday && (
                        <span className="ml-1.5 text-xs font-semibold text-brand-700">
                          ¡es hoy! 🎉
                        </span>
                      )}
                    </p>
                  </div>
                  {b.waHref && (
                    <a
                      href={b.waHref}
                      target="_blank"
                      rel="noreferrer"
                      aria-label={`Saludar a ${b.name} por WhatsApp`}
                      className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#25d366] text-white shadow-sm transition-all hover:bg-[#1fb958] active:scale-95 tap-highlight-none"
                    >
                      <MessageCircle className="size-4" />
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </RadarCard>

        {/* embudo rápido */}
        <RadarCard emoji="🎯" title="Embudo rápido">
          <div className="space-y-2.5 pt-1">
            {funnel.map((f) => (
              <div key={f.key} className="flex items-center gap-2.5">
                <span className={cn("size-2 shrink-0 rounded-full", f.dot)} />
                <span className="w-28 shrink-0 truncate text-[13px] text-ink-soft">
                  {f.label}
                </span>
                <div className="h-2 min-w-0 flex-1 overflow-hidden rounded-full bg-sand-soft">
                  <div
                    className={cn("h-full rounded-full transition-all", f.bar)}
                    style={{
                      width: f.count > 0 ? `${Math.max((f.count / funnelMax) * 100, 5)}%` : "0%",
                    }}
                  />
                </div>
                <span className="w-6 shrink-0 text-right text-sm font-semibold tabular-nums text-ink">
                  {f.count}
                </span>
              </div>
            ))}
          </div>
          <Link
            href="/crm"
            className="mt-3 inline-block text-[13px] font-medium text-brand-700 transition-colors hover:text-brand-800 tap-highlight-none"
          >
            Ver pipeline →
          </Link>
        </RadarCard>
      </div>
    </section>
  );
}

function RadarCard({
  emoji,
  title,
  children,
}: {
  emoji: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="card flex flex-col p-4">
      <p className="text-xs font-medium text-ink-soft">
        <span className="mr-1.5">{emoji}</span>
        {title}
      </p>
      <div className="mt-2 flex-1">{children}</div>
    </div>
  );
}

function RadarEmpty({ text }: { text: string }) {
  return <p className="py-4 text-[13px] text-ink-faint">{text}</p>;
}
