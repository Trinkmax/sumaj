"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip } from "@/components/ui/misc";
import { PaymentDialog } from "@/components/caja/payment-dialog";
import { PAYMENT_METHODS, waLink } from "@/lib/domain";
import { fmtDate, fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { appUrl } from "./helpers";
import type { PaymentRow } from "./types";

type PaymentFile = {
  id: string;
  code: string;
  currency: string;
  contact_id: string | null;
  contact_name: string;
  balance: number;
};

export function PaymentsCard({
  file,
  contactPhone,
  totals,
  payments,
  className,
}: {
  file: PaymentFile;
  contactPhone: string | null;
  totals: { total_sale: number; paid_total: number; balance: number };
  payments: PaymentRow[];
  className?: string;
}) {
  const router = useRouter();
  const [dialogOpen, setDialogOpen] = React.useState(false);
  const [mounted, setMounted] = React.useState(false);
  React.useEffect(() => setMounted(true), []);

  const pct =
    totals.total_sale > 0
      ? Math.min(100, Math.max(0, (totals.paid_total / totals.total_sale) * 100))
      : 0;
  const settled = totals.total_sale > 0 && totals.balance <= 0;

  return (
    <section className={cn("card animate-slide-up p-4 md:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="font-display text-lg font-semibold text-ink">Cobros</h2>
        <span className="text-xs tabular-nums text-ink-faint">
          {payments.length === 0
            ? "sin cobros"
            : `${payments.length} ${payments.length === 1 ? "cobro" : "cobros"}`}
        </span>
      </div>

      {/* progreso */}
      <div>
        <div className="flex items-baseline justify-between text-[13px]">
          <span className="text-ink-soft">
            Cobrado{" "}
            <span className="font-semibold tabular-nums text-money-700">
              {fmtMoney(totals.paid_total, file.currency)}
            </span>
          </span>
          <span className="tabular-nums text-ink-faint">
            de {fmtMoney(totals.total_sale, file.currency)}
          </span>
        </div>
        <div className="mt-1.5 h-2.5 overflow-hidden rounded-full bg-sand-soft">
          <div
            className="h-full rounded-full bg-money-600 transition-[width] duration-700 ease-out"
            style={{ width: mounted ? `${pct}%` : "0%" }}
          />
        </div>
      </div>

      {/* saldo */}
      {settled ? (
        <div className="mt-3 flex items-center justify-center gap-2 rounded-xl border border-money-100 bg-money-50 px-3 py-2.5 text-sm font-semibold text-money-700">
          Saldado ✅
        </div>
      ) : (
        <div className="mt-3 flex items-end justify-between rounded-xl bg-sand-soft/60 px-3.5 py-2.5">
          <span className="text-sm text-ink-soft">Saldo pendiente</span>
          <span className="text-xl font-bold tabular-nums text-amber-600">
            {fmtMoney(totals.balance, file.currency)}
          </span>
        </div>
      )}

      {/* registrar */}
      {!settled && (
        <Button
          variant="success"
          className="mt-3 w-full"
          size="lg"
          onClick={() => setDialogOpen(true)}
        >
          💵 Registrar cobro
        </Button>
      )}

      {/* lista */}
      {payments.length > 0 && (
        <div className="mt-4 divide-y divide-line border-t border-line">
          {payments.map((p) => (
            <PaymentItem
              key={p.id}
              payment={p}
              fileCurrency={file.currency}
              contactName={file.contact_name}
              contactPhone={contactPhone}
            />
          ))}
        </div>
      )}

      <PaymentDialog
        open={dialogOpen}
        onOpenChange={setDialogOpen}
        file={file}
        onSuccess={() => router.refresh()}
      />
    </section>
  );
}

function PaymentItem({
  payment: p,
  fileCurrency,
  contactName,
  contactPhone,
}: {
  payment: PaymentRow;
  fileCurrency: string;
  contactName: string;
  contactPhone: string | null;
}) {
  const [copied, setCopied] = React.useState(false);
  const crossCurrency = p.currency !== fileCurrency;
  const receiptUrl = `${appUrl()}/r/${p.receipt_token}`;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopied(true);
      toast.success("Link del recibo copiado ✅");
      setTimeout(() => setCopied(false), 1600);
    } catch {
      toast.error("No se pudo copiar. Probá de nuevo.");
    }
  };

  const waText = `¡Hola ${contactName.split(" ")[0]}! Acá está tu recibo ${
    p.receipt_code ?? ""
  }: ${receiptUrl}`;

  return (
    <div className="flex items-center gap-3 py-2.5">
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {PAYMENT_METHODS[p.method]}
          <span className="ml-1.5 font-normal text-ink-faint">{fmtDate(p.paid_at)}</span>
        </p>
        <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-faint">
          {p.receipt_code && (
            <span className="font-mono font-semibold text-ink-soft">{p.receipt_code}</span>
          )}
          {p.note && <span className="truncate">· {p.note}</span>}
        </p>
      </div>

      <div className="shrink-0 text-right">
        <p className="text-sm font-semibold tabular-nums text-money-700">
          {fmtMoney(p.amount, p.currency)}
        </p>
        {crossCurrency && (
          <p className="text-[11px] tabular-nums text-ink-faint">
            ≈ {fmtMoney(p.amount_in_file_currency, fileCurrency)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 items-center gap-0.5">
        <Tooltip content="Copiar link del recibo">
          <Button variant="ghost" size="icon-sm" onClick={copyLink} aria-label="Copiar link del recibo">
            {copied ? <Check className="text-money-700" /> : <Copy />}
          </Button>
        </Tooltip>
        {contactPhone && (
          <Tooltip content="Enviar recibo por WhatsApp">
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => window.open(waLink(contactPhone, waText), "_blank", "noopener")}
              aria-label="Enviar recibo por WhatsApp"
            >
              <svg viewBox="0 0 24 24" fill="#25d366" className="size-4" aria-hidden>
                <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38c1.45.79 3.08 1.2 4.7 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.94-.4-4.2-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.7-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
              </svg>
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
