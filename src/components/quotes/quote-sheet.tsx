import { quoteColor, quoteFont, SERVICE_TYPES, SERVICE_ORDER } from "@/lib/domain";
import { fmtDate, fmtDateLong, fmtMoney, fmtPhone } from "@/lib/format";
import type { ServiceType } from "@/lib/types";

/**
 * Datos planos del presupuesto de cara al cliente.
 * El componente NO fetchea: lo alimentan el builder (en vivo),
 * el detalle interno y la página pública (/p/[token]).
 * Nunca incluye costos ni comisiones.
 */
export type QuoteSheetData = {
  code: string;
  title: string | null;
  destination: string;
  currency: string;
  pax: number;
  nights: number | null;
  tripDateFrom: string | null;
  tripDateTo: string | null;
  validUntil: string | null;
  totalPrice: number;
  perPerson: number;
  discount: number;
  notes: string | null;
  createdAt: string | null;
  contactName: string | null;
  contactPhone: string | null;
  agencyName: string;
  agencyLogoUrl: string | null;
  agencyPhone: string | null;
  sellerName: string | null;
  items: { type: ServiceType; description: string }[];
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

export function QuoteSheet({ data, className }: { data: QuoteSheetData; className?: string }) {
  const color = quoteColor(data.theme?.color);
  const font = quoteFont(data.theme?.font);

  // agrupar servicios por tipo respetando el orden de la planilla
  const groups = SERVICE_ORDER.map((type) => ({
    type,
    items: data.items.filter((i) => i.type === type),
  })).filter((g) => g.items.length > 0);

  const softInk = { color: color.ink, opacity: 0.62 };

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
          {data.code} · {fmtDate(data.createdAt ?? new Date())}
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
          {data.pax} {data.pax === 1 ? "persona" : "personas"}
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

      {/* total */}
      <div className="mt-8 text-center">
        <p
          className="text-[10px] font-medium uppercase tracking-[0.32em]"
          style={{ color: color.accent }}
        >
          Total
        </p>
        <p className="mt-1.5 text-[34px] leading-none tracking-tight tabular-nums">
          {fmtMoney(data.totalPrice, data.currency)}
        </p>
        {data.pax > 1 && (
          <p className="mt-2 text-[13px] tabular-nums" style={softInk}>
            por persona {fmtMoney(data.perPerson, data.currency)}
          </p>
        )}
        {data.discount > 0 && (
          <p className="mt-1.5 text-[12px]" style={{ color: color.accent }}>
            incluye descuento de {fmtMoney(data.discount, data.currency)}
          </p>
        )}
      </div>

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
          {data.agencyName}
          {data.agencyPhone ? ` · ${fmtPhone(data.agencyPhone)}` : ""}
        </p>
        <p className="mt-4 text-[10px] uppercase tracking-[0.24em]" style={{ ...softInk, opacity: 0.45 }}>
          hecho con viajerOS
        </p>
      </div>
    </div>
  );
}
