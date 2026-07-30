import { ImageResponse } from "next/og";
import { createAnonClient } from "@/lib/supabase/server";
import { paxLabel, quoteColor, SERVICE_ORDER, SERVICE_TYPES } from "@/lib/domain";
import { fmtDate, fmtDateLong, fmtMoney, fmtPhone } from "@/lib/format";
import type { ServiceType } from "@/lib/types";

type QuotePublicOption = {
  name: string;
  subtitle: string | null;
  is_recommended: boolean;
  total_price: number;
  per_person: number;
};

type QuotePublic = {
  code: string;
  title: string | null;
  destination: string;
  currency: string;
  pax: number;
  pax_adults: number;
  pax_children: number;
  pax_infants: number;
  options: QuotePublicOption[] | null;
  nights: number | null;
  trip_date_from: string | null;
  trip_date_to: string | null;
  valid_until: string | null;
  total_price: number;
  per_person: number;
  discount: number;
  notes: string | null;
  theme: { color?: string; font?: string } | null;
  created_at: string;
  contact_name: string | null;
  agency: {
    name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
  };
  seller_name: string | null;
  items: { type: ServiceType; description: string }[];
};

/** La fuente cargada no incluye ★ (se ve como tofu ▯ en el PNG): lo reemplazamos por *. */
function sanitize(text: string): string {
  return text.replace(/★/g, "*");
}

/**
 * Carga una tipografía serif de Google Fonts como TTF estático
 * (user-agent viejo → sirve TTF). Si falla, seguimos con la default.
 */
async function loadSerifFont(): Promise<ArrayBuffer | null> {
  try {
    const css = await fetch(
      "https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@500",
      { headers: { "User-Agent": "Mozilla/5.0 (Windows NT 6.1)" } },
    ).then((r) => r.text());
    const match = css.match(/url\((https:[^)]+\.ttf)\)/);
    if (!match) return null;
    const res = await fetch(match[1]);
    if (!res.ok) return null;
    return await res.arrayBuffer();
  } catch {
    return null;
  }
}

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ token: string }> },
) {
  const { token } = await params;

  const supabase = createAnonClient();
  const { data } = await supabase.rpc("quote_public", { token });
  const quote = (data as QuotePublic | null) ?? null;
  if (!quote) return new Response("No encontrado", { status: 404 });

  const color = quoteColor(quote.theme?.color ?? undefined);
  const serif = await loadSerifFont();
  const fontFamily = serif ? "QuoteSerif" : undefined;

  const groups = SERVICE_ORDER.map((type) => ({
    type,
    items: quote.items.filter((i) => i.type === type),
  })).filter((g) => g.items.length > 0);

  const options = quote.options ?? [];

  const soft = { color: color.ink, opacity: 0.62 };
  const accentLabel = {
    color: color.accent,
    fontSize: 15,
    letterSpacing: 6,
    textTransform: "uppercase" as const,
  };

  const divider = (
    <div style={{ display: "flex", alignItems: "center", width: "100%", gap: 14 }}>
      <div style={{ display: "flex", flex: 1, height: 1, backgroundColor: color.accent, opacity: 0.35 }} />
      <div style={{ display: "flex", width: 7, height: 7, borderRadius: 999, backgroundColor: color.accent, opacity: 0.7 }} />
      <div style={{ display: "flex", flex: 1, height: 1, backgroundColor: color.accent, opacity: 0.35 }} />
    </div>
  );

  return new ImageResponse(
    (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          width: "100%",
          height: "100%",
          backgroundColor: color.bg,
          color: color.ink,
          padding: "64px 72px",
          ...(fontFamily ? { fontFamily } : {}),
        }}
      >
        {/* agencia */}
        <div
          style={{
            display: "flex",
            fontSize: 24,
            letterSpacing: 8,
            textTransform: "uppercase",
            textAlign: "center",
          }}
        >
          {quote.agency.name}
        </div>

        <div style={{ display: "flex", width: "100%", marginTop: 34 }}>{divider}</div>

        {/* título */}
        <div style={{ display: "flex", marginTop: 34, ...accentLabel, fontSize: 19, letterSpacing: 12 }}>
          PRESUPUESTO
        </div>
        <div style={{ display: "flex", marginTop: 8, fontSize: 15, letterSpacing: 4, ...soft }}>
          {`${quote.code} · ${fmtDate(quote.created_at)}`}
        </div>

        {/* para */}
        {quote.contact_name ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 30,
            }}
          >
            <div style={{ display: "flex", ...accentLabel, fontSize: 13 }}>PARA</div>
            <div style={{ display: "flex", marginTop: 4, fontSize: 24 }}>
              {quote.contact_name}
            </div>
          </div>
        ) : null}

        {/* destino */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 30,
          }}
        >
          <div style={{ display: "flex", ...accentLabel, fontSize: 13 }}>DESTINO</div>
          <div style={{ display: "flex", marginTop: 6, fontSize: 40, textAlign: "center" }}>
            {sanitize(quote.title || quote.destination)}
          </div>
          <div style={{ display: "flex", marginTop: 8, fontSize: 17, ...soft }}>
            {[
              quote.trip_date_from && quote.trip_date_to
                ? `${fmtDate(quote.trip_date_from)} — ${fmtDate(quote.trip_date_to)}`
                : null,
              quote.nights ? `${quote.nights} ${quote.nights === 1 ? "noche" : "noches"}` : null,
              paxLabel(
                {
                  adults: quote.pax_adults ?? Math.max(1, quote.pax),
                  children: quote.pax_children ?? 0,
                  infants: quote.pax_infants ?? 0,
                  childrenAges: [],
                },
                false,
              ),
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
        </div>

        {/* servicios */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: 30,
            gap: 20,
          }}
        >
          {groups.slice(0, 4).map((g) => (
            <div
              key={g.type}
              style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}
            >
              <div style={{ display: "flex", ...accentLabel, fontSize: 13 }}>
                {SERVICE_TYPES[g.type].plural.toUpperCase()}
              </div>
              {g.items.slice(0, 4).map((item, i) => (
                <div
                  key={i}
                  style={{ display: "flex", fontSize: 17, textAlign: "center", maxWidth: 620 }}
                >
                  {sanitize(
                    item.description.length > 70
                      ? `${item.description.slice(0, 70)}…`
                      : item.description,
                  )}
                </div>
              ))}
            </div>
          ))}
        </div>

        <div style={{ display: "flex", width: "100%", marginTop: 34 }}>{divider}</div>

        {/* precio: por persona grande, total chico (o una tarjeta por opción) */}
        {options.length > 0 ? (
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              marginTop: 26,
              width: "100%",
              gap: 14,
            }}
          >
            <div style={{ display: "flex", ...accentLabel, fontSize: 13 }}>
              {options.length === 2 ? "DOS OPCIONES" : "OPCIONES"}
            </div>
            {options.slice(0, 3).map((o, i) => (
              <div
                key={i}
                style={{
                  display: "flex",
                  flexDirection: "column",
                  alignItems: "center",
                  width: "100%",
                  padding: "18px 22px",
                  border: `1px solid ${color.accent}${o.is_recommended ? "66" : "33"}`,
                  borderRadius: 3,
                }}
              >
                <div style={{ display: "flex", fontSize: 22, textAlign: "center" }}>
                  {sanitize(o.name)}
                </div>
                <div style={{ display: "flex", marginTop: 8, fontSize: 40 }}>
                  {fmtMoney(Number(o.per_person), quote.currency)}
                </div>
                <div style={{ display: "flex", marginTop: 2, fontSize: 14, ...soft }}>
                  por persona
                </div>
                <div style={{ display: "flex", marginTop: 6, fontSize: 15, ...soft }}>
                  {`total ${fmtMoney(Number(o.total_price), quote.currency)}`}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <>
            <div style={{ display: "flex", marginTop: 30, ...accentLabel, fontSize: 13 }}>
              POR PERSONA
            </div>
            <div style={{ display: "flex", marginTop: 6, fontSize: 56 }}>
              {fmtMoney(Number(quote.per_person), quote.currency)}
            </div>
            <div style={{ display: "flex", marginTop: 8, fontSize: 17, ...soft }}>
              {`total ${fmtMoney(Number(quote.total_price), quote.currency)}`}
            </div>
          </>
        )}
        {Number(quote.discount) > 0 ? (
          <div style={{ display: "flex", marginTop: 6, fontSize: 15, color: color.accent }}>
            {`incluye descuento de ${fmtMoney(Number(quote.discount), quote.currency)}`}
          </div>
        ) : null}

        {/* validez */}
        {quote.valid_until ? (
          <div style={{ display: "flex", marginTop: 26, fontSize: 15, ...soft }}>
            {`Válido hasta ${fmtDateLong(quote.valid_until)}`}
          </div>
        ) : null}

        {/* pie, empujado hacia abajo */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            marginTop: "auto",
            width: "100%",
            gap: 10,
          }}
        >
          {divider}
          <div style={{ display: "flex", marginTop: 10, fontSize: 15, ...soft }}>
            {/* del contacto de la agencia va lo que exista: sin teléfono no queda un separador colgado */}
            {[
              quote.seller_name,
              quote.agency.name,
              quote.agency.phone ? fmtPhone(quote.agency.phone) : null,
              quote.agency.email,
            ]
              .filter(Boolean)
              .join(" · ")}
          </div>
          <div style={{ display: "flex", fontSize: 12, letterSpacing: 4, ...soft, opacity: 0.45 }}>
            HECHO CON VIAJEROS
          </div>
        </div>
      </div>
    ),
    {
      width: 800,
      height: 1130,
      ...(serif
        ? { fonts: [{ name: "QuoteSerif", data: serif, style: "normal" as const, weight: 500 as const }] }
        : {}),
      headers: {
        "Cache-Control": "public, s-maxage=300, stale-while-revalidate=600",
      },
    },
  );
}
