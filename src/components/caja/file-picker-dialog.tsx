"use client";

import * as React from "react";
import Link from "next/link";
import { CheckCircle2, Luggage, Plus, Search, SearchX } from "lucide-react";
import { Dialog, DialogContent } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { Avatar } from "@/components/ui/avatar";
import { fmtMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DebtorFile } from "./types";

/**
 * Mini-picker: elegir a quién cobrarle antes de abrir el PaymentDialog.
 * Lista los files con saldo y también los que todavía no tienen servicios
 * cargados: el día que se vende se cobra la seña y los servicios vienen después.
 */
export function FilePickerDialog({
  open,
  onOpenChange,
  files,
  hasAnyFile,
  onPick,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  files: DebtorFile[];
  /** para distinguir "no hay ninguna venta cargada" de "están todos al día" */
  hasAnyFile: boolean;
  onPick: (f: DebtorFile) => void;
}) {
  const [query, setQuery] = React.useState("");

  React.useEffect(() => {
    if (open) setQuery("");
  }, [open]);

  const q = query.trim().toLowerCase();
  const filtered = q
    ? files.filter(
        (d) =>
          d.contact_name.toLowerCase().includes(q) ||
          d.code.toLowerCase().includes(q) ||
          d.destination.toLowerCase().includes(q),
      )
    : files;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent title="¿A quién le cobrás?" description="Elegí el file del cobro" size="md">
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
            q ? (
              <EmptyState
                icon={SearchX}
                title="No encontramos nada con eso"
                description="Probá con otro nombre o código de file."
              />
            ) : hasAnyFile ? (
              <EmptyState
                icon={CheckCircle2}
                title="Nadie debe nada"
                description="Todos los files están al día."
              />
            ) : (
              <EmptyState
                icon={Luggage}
                title="Todavía no hay files"
                description="Los cobros van sobre un file. Te llevamos a Files para crear el primero."
                action={
                  <Link href="/files">
                    <Button variant="brand">
                      <Plus /> Crear el primer file
                    </Button>
                  </Link>
                }
              />
            )
          ) : (
            <div
              className={cn(
                "-mx-1 flex max-h-[50dvh] flex-col overflow-y-auto",
                filtered.length <= 14 && "stagger-children",
              )}
            >
              {filtered.map((d) => (
                <button
                  key={d.id}
                  type="button"
                  onClick={() => onPick(d)}
                  className="flex min-h-16 items-center gap-3 rounded-2xl px-3 py-2.5 text-left transition-colors hover:bg-sand-soft/70 tap-highlight-none active:scale-[0.99]"
                >
                  <Avatar name={d.contact_name} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium text-ink">{d.contact_name}</p>
                    <p className="truncate text-xs text-ink-faint">
                      <span className="font-mono font-medium text-ink-soft">{d.code}</span>
                      {" · "}
                      {d.destination}
                    </p>
                  </div>
                  {d.total_sale > 0.004 ? (
                    <div className="text-right">
                      <p className="text-sm font-semibold tabular-nums text-tone-amber-text">
                        {fmtMoney(d.balance, d.currency)}
                      </p>
                      <p className="text-[11px] text-ink-faint">debe</p>
                    </div>
                  ) : (
                    <span className="shrink-0 rounded-full border border-line bg-sand-soft px-2 py-0.5 text-[11px] font-medium text-ink-faint">
                      Sin servicios
                    </span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
