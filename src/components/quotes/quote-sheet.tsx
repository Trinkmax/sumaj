import { INFANT_FACTOR, paxLabel, quoteColor, quoteFont, SERVICE_TYPES, SERVICE_ORDER } from "@/lib/domain";
import { fmtDate, fmtDateLong, fmtMoney, fmtPhone } from "@/lib/format";
import type { QuotePax } from "@/lib/domain";
import type { ServiceType } from "@/lib/types";

/**
 * Datos planos del presupuesto de cara al cliente.
 * El componente NO fetchea: lo alimentan el builder (en vivo),
 * el detalle interno y la página pública (/p/[token]).
 * Nunca incluye costos ni comisiones.
 */
export type QuoteSheetItem = { type: ServiceType; description: string };

export type QuoteSheetOption = {
  name: string;
  subtitle: string | null;
  isRecommended: boolean;
  totalPrice: number;
  perPerson: number;
  perInfant: number;
  items: QuoteSheetItem[];
};

export type QuoteSheetData = {
  /** vacío mientras el presupuesto no se guardó: el código lo pone la DB */
  code: string;
  title: string | null;
  destination: string;
  currency: string;
  pax: QuotePax;
  nights: number | null;
  tripDateFrom: string | null;
  tripDateTo: string | null;
  validUntil: string | null;
  totalPrice: number;
  perPerson: number;
  perInfant: number;
  discount: number;
  notes: string | null;
  createdAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  agencyName: string;
  agencyLogoUrl: string | null;
  agencyPhone: string | null;
  /** opcional: si la agencia no tiene teléfono, el mail es el único contacto del pie */
  agencyEmail?: string | null;
  sellerName: string | null;
  items: QuoteSheetItem[];
  /** alternativas comparables: "con este hotel vale 10, con este otro 15" */
  options: QuoteSheetOption[];
  theme: { color?: string; font?: string };
};

/** ────── • ────── línea fina con puntito central (marca de la casa) */
function DotDivider({ color }: { color: string }) {
  return (
    <div className="flex items-center gap-3" aria-hidden>
      <span className="h-px flex-1" style={{ backgroundColor: color, opacity: 0.35 }} />
      <span
        className="size-[5px] rounded-full"
        style={{ backgroundColor: color, opacity: 0.7 }}
      />
      <span className="h-px flex-1" style={{ backgroundColor: color, opacity: 0.35 }} />
    </div>
  );
}

/** grupos de servicios ordenados como la planilla */
function groupItems(items: QuoteSheetItem[]) {
  return SERVICE_ORDER.map((type) => ({
    type,
    items: items.filter((i) => i.type === type),
  })).filter((g) => g.items.length > 0);
}

export function QuoteSheet({ data, className }: { data: QuoteSheetData; className?: string }) {
  const color = quoteColor(data.theme?.color);
  const font = quoteFont(data.theme?.font);

  const groups = groupItems(data.items);
  const softInk = { color: color.ink, opacity: 0.62 };
  const hasOptions = data.options.length > 0;

  /* del código y del contacto de la agencia va lo que exista: nada de separadores
     colgados cuando falta el teléfono o el presupuesto todavía no tiene número */
  const codeLine = [data.code, fmtDate(data.createdAt ?? new Date())]
    .filter(Boolean)
    .join(" · ");
  const contactLine = [
    data.agencyName,
    data.agencyPhone ? fmtPhone(data.agencyPhone) : null,
    data.agencyEmail,
  ]
    .filter(Boolean)
    .join(" · ");

  return (
    <div
      className={`mx-auto w-full max-w-[420px] rounded-[4px] px-8 py-10 shadow-[0_2px_24px_rgb(33_29_24/0.10)] sm:px-10 sm:py-12 ${className ?? ""}`}
      style={{ backgroundColor: color.bg, color: color.ink, fontFamily: font.css }}
    >
      {/* agencia */}
      <div className="flex flex-col items-center text-center">
        {data.agencyLogoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={data.agencyLogoUrl}
            alt={data.agencyName}
            className="mb-1 h-12 w-auto max-w-[180px] object-contain"
          />
        ) : (
          <p className="text-[15px] font-semibold uppercase tracking-[0.28em]">
            {data.agencyName}
          </p>
        )}
      </div>

      <div className="mt-6">
        <DotDivider color={color.accent} />
      </div>

      {/* título */}
      <div className="mt-6 text-center">
        <p
          className="text-[13px] font-medium uppercase tracking-[0.42em]"
          style={{ color: color.accent }}
        >
          Presupuesto
        </p>
        <p className="mt-1.5 text-[11px] uppercase tracking-[0.18em]" style={softInk}>
          {codeLine}
        </p>
      </div>

      {/* para */}
      {data.contactName && (
        <div className="mt-8 text-center">
          <p
            className="text-[10px] font-medium uppercase tracking-[0.32em]"
            style={{ color: color.accent }}
          >
            Para
          </p>
          <p className="mt-1 text-[17px]">{data.contactName}</p>
          {data.contactPhone && (
            <p className="text-[12px] tabular-nums" style={softInk}>
              {fmtPhone(data.contactPhone)}
            </p>
          )}
        </div>
      )}

      {/* destino */}
      <div className="mt-8 text-center">
        <p
          className="text-[10px] font-medium uppercase tracking-[0.32em]"
          style={{ color: color.accent }}
        >
          Destino
        </p>
        <p className="mt-1.5 text-[26px] leading-tight tracking-tight">
          {data.title || data.destination}
        </p>
        {data.title && data.title !== data.destination && (
          <p className="mt-0.5 text-[13px]" style={softInk}>
            {data.destination}
          </p>
        )}
        {(data.tripDateFrom || data.tripDateTo) && (
          <p className="mt-2 text-[13px]" style={softInk}>
            {data.tripDateFrom ? fmtDate(data.tripDateFrom) : "—"}
            {" — "}
            {data.tripDateTo ? fmtDate(data.tripDateTo) : "—"}
          </p>
        )}
        <p className="mt-0.5 text-[13px]" style={softInk}>
          {data.nights ? `${data.nights} ${data.nights === 1 ? "noche" : "noches"} · ` : ""}
          {paxLabel(data.pax)}
        </p>
      </div>

      {/* servicios — etiqueta tipográfica fina con icono lucide delgado */}
      {groups.length > 0 && (
        <div className="mt-9 space-y-6">
          {groups.map((g) => {
            const GroupIcon = SERVICE_TYPES[g.type].icon;
            return (
              <div key={g.type}>
                <div className="flex flex-col items-center gap-1.5">
                  <GroupIcon
                    className="size-4"
                    strokeWidth={1.5}
                    style={{ color: color.accent }}
                    aria-hidden
                  />
                  <p
                    className="text-center text-[11px] font-medium uppercase tracking-[0.28em]"
                    style={{ color: color.accent }}
                  >
                    {SERVICE_TYPES[g.type].plural}
                  </p>
                </div>
                <ul className="mt-2.5 space-y-1.5">
                  {g.items.map((item, i) => (
                    <li key={i} className="text-center text-[14px] leading-snug">
                      {item.description}
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}

      <div className="mt-9">
        <DotDivider color={color.accent} />
      </div>

      {hasOptions ? (
        /* ── opciones comparables: cada una con su precio ── */
        <div className="mt-8">
          <p
            className="text-center text-[10px] font-medium uppercase tracking-[0.32em]"
            style={{ color: color.accent }}
          >
            {data.options.length === 2 ? "Dos opciones" : "Opciones"}
          </p>
          <div className="mt-4 space-y-4">
            {data.options.map((o, idx) => (
              <div
                key={idx}
                className="rounded-[3px] px-5 py-5 text-center"
                style={{
                  border: `1px solid ${color.accent}${o.isRecommended ? "66" : "33"}`,
                  boxShadow: o.isRecommended ? `0 0 0 3px ${color.accent}14` : undefined,
                }}
              >
                {o.isRecommended && (
                  <p
                    className="mb-1.5 text-[9px] font-medium uppercase tracking-[0.3em]"
                    style={{ color: color.accent }}
                  >
                    Nuestra recomendación
                  </p>
                )}
                <p className="text-[17px] leading-tight">{o.name}</p>
                {o.subtitle && (
                  <p className="mt-0.5 text-[12px]" style={softInk}>
                    {o.subtitle}
                  </p>
                )}
                {o.items.length > 0 && (
                  <ul className="mt-2.5 space-y-1">
                    {o.items.map((item, i) => (
                      <li key={i} className="text-[13px] leading-snug" style={softInk}>
                        {item.description}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="mt-4 text-[28px] leading-none tracking-tight tabular-nums">
                  {fmtMoney(o.perPerson, data.currency)}
                </p>
                <p className="mt-1 text-[11px] uppercase tracking-[0.2em]" style={softInk}>
                  por persona
                </p>
                <p className="mt-2 text-[12px] tabular-nums" style={softInk}>
                  total {fmtMoney(o.totalPrice, data.currency)}
                  {data.pax.infants > 0
                    ? ` · infante ${fmtMoney(o.perInfant, data.currency)}`
                    : ""}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── precio: por persona grande, total chico ── */
        <div className="mt-8 text-center">
          <p
            className="text-[10px] font-medium uppercase tracking-[0.32em]"
            style={{ color: color.accent }}
          >
            Por persona
          </p>
          <p className="mt-1.5 text-[38px] leading-none tracking-tight tabular-nums">
            {fmtMoney(data.perPerson, data.currency)}
          </p>
          <p className="mt-3 text-[13px] tabular-nums" style={softInk}>
            total {fmtMoney(data.totalPrice, data.currency)}
          </p>
          {data.pax.infants > 0 && (
            <p className="mt-1 text-[12px] tabular-nums" style={softInk}>
              el infante paga {fmtMoney(data.perInfant, data.currency)} (
              {Math.round(INFANT_FACTOR * 100)}%)
            </p>
          )}
          {data.discount > 0 && (
            <p className="mt-1.5 text-[12px]" style={{ color: color.accent }}>
              incluye descuento de {fmtMoney(data.discount, data.currency)}
            </p>
          )}
        </div>
      )}

      {/* notas */}
      {data.notes && (
        <div className="mt-8 text-center">
          <p className="whitespace-pre-line text-[13px] italic leading-relaxed" style={softInk}>
            {data.notes}
          </p>
        </div>
      )}

      {/* validez */}
      {data.validUntil && (
        <p className="mt-8 text-center text-[12px]" style={softInk}>
          Válido hasta {fmtDateLong(data.validUntil)}
        </p>
      )}

      <div className="mt-8">
        <DotDivider color={color.accent} />
      </div>

      {/* pie */}
      <div className="mt-6 text-center">
        {data.sellerName && <p className="text-[13px]">{data.sellerName}</p>}
        <p className="text-[12px] tabular-nums" style={softInk}>
          {contactLine}
        </p>
        <p className="mt-4 text-[10px] uppercase tracking-[0.24em]" style={{ ...softInk, opacity: 0.45 }}>
          hecho con viajerOS
        </p>
      </div>
    </div>
  );
}
