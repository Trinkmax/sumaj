"use client";

import * as React from "react";
import { Search } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { fmtMoney } from "@/lib/format";
import type { DebtorFile } from "./types";

/**
 * Mini-picker: elegir a quién cobrarle (files con saldo > 0)
 * antes de abrir el PaymentDialog.
 */
export function FilePickerDialog({
  open,
  onOpenChange,
  debtors,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  debtors: DebtorFile[];
  onPick: (f: DebtorFile) => void;
}) {
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? debtors.filter(
        (d) =>
          d.contact_name.toLowerCase().includes(q) ||
          d.code.toLowerCase().includes(q) ||
          d.destination.toLowerCase().includes(q),
      )
    : debtors;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="¿A quién le cobrás?" description="Files con saldo pendiente" size="md">
        <div className="flex flex-col gap-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-ink-faint" />
            <Input
              autoFocus
              placeholder="Buscá por cliente, file o destino…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="pl-10"
            />
          </div>

          {filtered.length === 0 ? (
            <EmptyState
              emoji="✅"
              title={q ? "No encontramos nada con eso" : "Nadie debe nada"}
              description={
                q ? "Probá con otro nombre o código de file." : "Todos los files están al día."
              }
            />
          ) : (
            <div className="-mx-1 flex max-h-[50dvh] flex-col overflow-y-auto">
              {filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onPick(d)}
                  className="flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sand-soft/70 tap-highlight-none"
                >
                  <Avatar name={d.contact_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{d.contact_name}</p>
                    <p className="truncate text-xs text-ink-faint">
                      {d.code} · {d.destination}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold tabular-nums text-ink">
                      {fmtMoney(d.balance, d.currency)}
                    </p>
                    <p className="text-[11px] text-ink-faint">debe</p>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
