import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { createAnonClient } from "@/lib/supabase/server";
import { PAYMENT_METHODS, quoteColor, quoteFont, round2 } from "@/lib/domain";
import { fmtDateLong, fmtMoney, fmtNumber, fmtPhone } from "@/lib/format";
import type { PaymentMethod } from "@/lib/types";

export const metadata: Metadata = {
  title: "Recibo",
  robots: { index: false, follow: false },
};

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type ReceiptData = {
  code: string | null;
  amount: number;
  currency: string;
  exchange_rate: number | null;
  method: PaymentMethod;
  paid_at: string;
  note: string | null;
  contact_name: string | null;
  file_code: string;
  destination: string;
  file_currency: string;
  total_sale: number;
  paid_total: number;
  balance: number;
  agency: {
    name: string;
    logo_url: string | null;
    phone: string | null;
    email: string | null;
  };
  theme: { color?: string; font?: string } | null;
};

/** línea fina con puntito central — estética papelería */
function Divider({ color }: { color: string }) {
  return (
    <div className="flex w-full items-center gap-3" aria-hidden>
      <span className="h-px flex-1" style={{ backgroundColor: color, opacity: 0.35 }} />
      <span className="text-xs leading-none" style={{ color }}>
        ·
      </span>
      <span className="h-px flex-1" style={{ backgroundColor: color, opacity: 0.35 }} />
    </div>
  );
}

/**
 * Recibo público que ve el cliente.
 * Papelería fina SIEMPRE clara: colores inline del tema de la agencia
 * (quoteColor/quoteFont), independiente del modo claro/oscuro de la app.
 */
export default async function PublicReceiptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  if (!UUID_RE.test(token)) notFound();

  const supabase = createAnonClient();
  const { data } = await supabase.rpc("receipt_public", { token });
  if (!data) notFound();

  const r = data as unknown as ReceiptData;
  const color = quoteColor(r.theme?.color);
  const font = quoteFont(r.theme?.font);

  const isCross = r.currency !== r.file_currency && !!r.exchange_rate;
  const converted = isCross ? round2(Number(r.amount) / Number(r.exchange_rate)) : null;

  const totalSale = Number(r.total_sale);
  const paidTotal = Number(r.paid_total);
  /** sin servicios cargados el file no tiene venta: no hay estado de cuenta que mostrar
      (y el balance queda negativo, así que el sello de saldado sería falso) */
  const hasSale = totalSale > 0.004;
  const settled = hasSale && Number(r.balance) <= 0.004;
  /** el acumulado solo suma información si este cobro no es el único */
  const hasEarlierPayments = round2(paidTotal - (converted ?? Number(r.amount))) > 0.004;

  const contactLines = [
    r.agency.name,
    r.agency.phone ? fmtPhone(r.agency.phone) : null,
    r.agency.email,
  ].filter(Boolean);

  return (
    <main
      className="flex min-h-dvh items-center justify-center px-4 py-10"
      style={{ backgroundColor: color.bg, color: color.ink, fontFamily: font.css }}
    >
      <div
        className="w-full max-w-[480px] rounded-none px-2 py-4 text-center sm:rounded-3xl sm:border sm:px-10 sm:py-12"
        style={{ borderColor: `${color.accent}40` }}
      >
        {/* agencia */}
        {r.agency.logo_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={r.agency.logo_url}
            alt={r.agency.name}
            className="mx-auto mb-3 h-14 w-14 rounded-full object-cover"
          />
        ) : (
          <div
            className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-full border text-xl font-semibold"
            style={{ borderColor: `${color.accent}66`, color: color.accent }}
            aria-hidden
          >
            {r.agency.name.trim().charAt(0).toUpperCase()}
          </div>
        )}
        <p className="text-lg font-semibold tracking-tight">{r.agency.name}</p>

        <div className="my-6">
          <Divider color={color.accent} />
        </div>

        {/* título */}
        <p
          className="text-[11px] uppercase"
          style={{ color: color.accent, letterSpacing: "0.35em" }}
        >
          Recibo
        </p>
        <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{r.code}</p>
        <p className="mt-2 text-sm" style={{ opacity: 0.7 }}>
          {fmtDateLong(r.paid_at)}
        </p>

        <div className="my-6">
          <Divider color={color.accent} />
        </div>

        {/* recibimos de */}
        <p
          className="text-[11px] uppercase"
          style={{ color: color.accent, letterSpacing: "0.25em" }}
        >
          Recibimos de
        </p>
        <p className="mt-1 text-2xl">{r.contact_name ?? "—"}</p>

        {/* monto */}
        <p className="mt-6 text-5xl font-semibold tracking-tight tabular-nums">
          {fmtMoney(Number(r.amount), r.currency)}
        </p>
        {isCross && converted !== null && (
          <p className="mt-2 text-sm tabular-nums" style={{ opacity: 0.7 }}>
            = {fmtMoney(converted, r.file_currency)} · cotización ${" "}
            {fmtNumber(Number(r.exchange_rate))}
          </p>
        )}
        <p className="mt-3 text-sm" style={{ opacity: 0.75 }}>
          {PAYMENT_METHODS[r.method]?.label ?? r.method}
        </p>
        <p className="mt-1 text-sm" style={{ opacity: 0.75 }}>
          por el file {r.file_code} — {r.destination}
        </p>
        {r.note && (
          <p className="mt-3 text-sm italic" style={{ opacity: 0.65 }}>
            “{r.note}”
          </p>
        )}

        {/* estado de cuenta — solo cuando el viaje ya tiene monto cargado */}
        {hasSale ? (
          <>
            <div className="my-6">
              <Divider color={color.accent} />
            </div>
            <p
              className="mb-3 text-[11px] uppercase"
              style={{ color: color.accent, letterSpacing: "0.25em" }}
            >
              Estado de cuenta
            </p>
            <div className="mx-auto flex max-w-[320px] flex-col gap-1.5 text-sm">
              <div className="flex items-baseline justify-between">
                <span style={{ opacity: 0.7 }}>Total del viaje</span>
                <span className="tabular-nums">{fmtMoney(totalSale, r.file_currency)}</span>
              </div>
              <div className="flex items-baseline justify-between">
                <span style={{ opacity: 0.7 }}>Pagado</span>
                <span className="tabular-nums">{fmtMoney(paidTotal, r.file_currency)}</span>
              </div>
              {settled ? (
                <p
                  className="mx-auto mt-3 inline-flex items-center gap-2 rounded-full border px-4 py-1.5 text-sm font-semibold uppercase"
                  style={{
                    color: color.accent,
                    borderColor: `${color.accent}55`,
                    letterSpacing: "0.2em",
                  }}
                >
                  <CheckCircle2
                    className="size-4 shrink-0"
                    strokeWidth={1.5}
                    aria-hidden
                  />
                  Saldado
                </p>
              ) : (
                <div className="flex items-baseline justify-between text-base font-semibold">
                  <span>Saldo</span>
                  <span className="tabular-nums">
                    {fmtMoney(Number(r.balance), r.file_currency)}
                  </span>
                </div>
              )}
            </div>
          </>
        ) : hasEarlierPayments ? (
          <>
            <div className="my-6">
              <Divider color={color.accent} />
            </div>
            <p
              className="mb-2 text-[11px] uppercase"
              style={{ color: color.accent, letterSpacing: "0.25em" }}
            >
              A cuenta
            </p>
            <p className="text-sm" style={{ opacity: 0.75 }}>
              Pagado hasta hoy{" "}
              <span className="font-semibold tabular-nums" style={{ opacity: 1 }}>
                {fmtMoney(paidTotal, r.file_currency)}
              </span>
            </p>
          </>
        ) : null}

        <div className="my-6">
          <Divider color={color.accent} />
        </div>

        {/* pie */}
        <p className="text-sm" style={{ opacity: 0.75 }}>
          {contactLines.join(" · ")}
        </p>
        <p className="mt-4 text-[11px]" style={{ color: color.accent, opacity: 0.9 }}>
          hecho con viajerOS
        </p>
      </div>
    </main>
  );
}
