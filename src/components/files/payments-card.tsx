"use client";

import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Banknote, Check, CheckCircle2, Copy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tooltip, ProgressRing } from "@/components/ui/misc";
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
      ? Math.min(1, Math.max(0, totals.paid_total / totals.total_sale))
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

      {/* progreso cobrado/total */}
      <div className="flex items-center gap-4">
        <ProgressRing
          value={mounted ? pct : 0}
          size={64}
          strokeWidth={6}
          className="shrink-0 text-money-700"
        >
          <span className="text-[13px] font-bold tabular-nums text-ink">
            {Math.round(pct * 100)}%
          </span>
        </ProgressRing>

        <div className="min-w-0 flex-1">
          <p className="truncate text-xl font-bold tabular-nums text-money-text">
            {fmtMoney(totals.paid_total, file.currency)}
          </p>
          <p className="text-[13px] text-ink-faint">
            cobrado de{" "}
            <span className="font-medium tabular-nums text-ink-soft">
              {fmtMoney(totals.total_sale, file.currency)}
            </span>
          </p>
          {settled ? (
            <span className="mt-1.5 inline-flex animate-pop items-center gap-1 rounded-full border border-tone-emerald-line bg-tone-emerald-soft px-2.5 py-0.5 text-xs font-semibold text-tone-emerald-text">
              <CheckCircle2 className="size-3.5" strokeWidth={2} />
              Saldado
            </span>
          ) : (
            <p className="mt-1 text-[13px]">
              <span className="text-ink-faint">Saldo</span>{" "}
              <span className="font-bold tabular-nums text-tone-amber-text">
                {fmtMoney(totals.balance, file.currency)}
              </span>
            </p>
          )}
        </div>
      </div>

      {/* registrar */}
      {!settled && (
        <Button
          variant="success"
          className="mt-4 w-full"
          size="lg"
          onClick={() => setDialogOpen(true)}
        >
          <Banknote /> Registrar cobro
        </Button>
      )}

      {/* lista */}
      {payments.length > 0 && (
        <div
          className={cn(
            "mt-4 divide-y divide-line border-t border-line",
            payments.length <= 14 && "stagger-children",
          )}
        >
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
  const method = PAYMENT_METHODS[p.method];
  const MethodIcon = method.icon;

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(receiptUrl);
      setCopied(true);
      toast.success("Link del recibo copiado");
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
      <span className="flex size-9 shrink-0 items-center justify-center rounded-full bg-money-tint text-money-text">
        <MethodIcon className="size-4" strokeWidth={1.9} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">
          {method.label}
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
        <p className="text-sm font-semibold tabular-nums text-money-text">
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
          <Button
            variant="ghost"
            size="icon-sm"
            onClick={copyLink}
            aria-label="Copiar link del recibo"
          >
            {copied ? (
              <Check className="animate-check-pop text-money-text" />
            ) : (
              <Copy />
            )}
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
              <svg
                viewBox="0 0 24 24"
                fill="currentColor"
                className="size-4 !text-wa-accent"
                aria-hidden
              >
                <path d="M12.04 2c-5.46 0-9.9 4.44-9.9 9.9 0 1.75.46 3.45 1.32 4.95L2.05 22l5.3-1.38c1.45.79 3.08 1.2 4.7 1.2h.01c5.46 0 9.9-4.44 9.9-9.9 0-2.65-1.03-5.14-2.9-7.01A9.82 9.82 0 0 0 12.04 2Zm0 18.15c-1.48 0-2.94-.4-4.2-1.15l-.3-.18-3.12.82.83-3.05-.2-.31a8.26 8.26 0 0 1-1.26-4.38c0-4.54 3.7-8.24 8.25-8.24 2.2 0 4.27.86 5.82 2.42a8.18 8.18 0 0 1 2.41 5.83c0 4.54-3.7 8.24-8.23 8.24Zm4.52-6.16c-.25-.13-1.47-.72-1.7-.8-.22-.09-.39-.13-.55.12-.17.25-.64.8-.78.97-.15.16-.29.18-.54.06-.25-.13-1.05-.39-2-1.23-.73-.66-1.23-1.47-1.38-1.72-.14-.25-.01-.38.11-.51.11-.11.25-.29.37-.43.12-.15.16-.25.25-.41.08-.17.04-.31-.02-.43-.06-.13-.55-1.34-.76-1.84-.2-.48-.4-.42-.55-.42h-.47c-.16 0-.43.06-.66.31-.22.25-.86.85-.86 2.07 0 1.22.89 2.4 1.01 2.56.12.17 1.75 2.67 4.23 3.74.59.26 1.05.41 1.41.52.6.19 1.13.16 1.56.1.48-.07 1.47-.6 1.67-1.18.21-.58.21-1.07.15-1.18-.06-.1-.23-.16-.48-.29Z" />
              </svg>
            </Button>
          </Tooltip>
        )}
      </div>
    </div>
  );
}
