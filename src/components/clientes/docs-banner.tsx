"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown, ChevronRight, IdCard } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  DOC_TYPE_LABELS,
  expiryCountdown,
  isExpired,
  type ExpiringDoc,
} from "./types";

/** Banner de documentos de viaje por vencer (<90 días). Expandible, linkea al pasajero. */
export function DocsBanner({ docs }: { docs: ExpiringDoc[] }) {
  const [open, setOpen] = React.useState(false);
  const expired = docs.filter((d) => isExpired(d.expiry)).length;

  return (
    <div className="animate-slide-up overflow-hidden rounded-2xl border border-tone-amber-line bg-tone-amber-soft">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left tap-highlight-none"
        aria-expanded={open}
      >
        <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-paper/70 text-tone-amber-text">
          <IdCard className="size-4.5" strokeWidth={1.9} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-tone-amber-text">
            {docs.length === 1
              ? "1 documento de viaje vence pronto"
              : `${docs.length} documentos de viaje vencen pronto`}
          </span>
          {expired > 0 && (
            <span className="block text-xs text-tone-red-text">
              {expired === 1 ? "1 ya está vencido" : `${expired} ya están vencidos`}
            </span>
          )}
        </span>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-tone-amber-text transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul className="animate-fade-in border-t border-tone-amber-line/60 px-2 py-1.5">
          {docs.map((d) => (
            <li key={d.travelerId}>
              <Link
                href={`/clientes/${d.contactId}`}
                className="group flex min-h-11 items-center gap-3 rounded-xl px-2 py-1.5 transition-colors tap-highlight-none hover:bg-paper/50"
              >
                <span className="min-w-0 flex-1 truncate text-sm text-tone-amber-text">
                  <span className="font-medium">{d.travelerName}</span>
                  {d.documentType && (
                    <span className="opacity-75"> · {DOC_TYPE_LABELS[d.documentType]}</span>
                  )}
                  {d.travelerName !== d.contactName && (
                    <span className="opacity-75"> · grupo de {d.contactName}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border bg-paper px-2 py-0.5 text-[11px] font-medium tabular-nums",
                    isExpired(d.expiry)
                      ? "border-tone-red-line text-tone-red-text"
                      : "border-tone-amber-line text-tone-amber-text",
                  )}
                >
                  {expiryCountdown(d.expiry)}
                </span>
                <ChevronRight className="size-3.5 shrink-0 text-tone-amber-text/50 transition-transform group-hover:translate-x-0.5" />
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
