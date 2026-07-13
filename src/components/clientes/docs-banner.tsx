"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronDown } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { isExpired, type ExpiringDoc } from "./types";

/** Banner ámbar: documentos de viaje que vencen en <90 días. Expandible. */
export function DocsBanner({ docs }: { docs: ExpiringDoc[] }) {
  const [open, setOpen] = React.useState(false);

  return (
    <div className="animate-slide-up overflow-hidden rounded-2xl border border-amber-200 bg-amber-50">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left tap-highlight-none"
        aria-expanded={open}
      >
        <p className="text-sm font-medium text-amber-900">
          🛂 {docs.length === 1
            ? "1 documento de viaje vence pronto"
            : `${docs.length} documentos de viaje vencen pronto`}
        </p>
        <ChevronDown
          className={cn(
            "size-4 shrink-0 text-amber-700 transition-transform duration-200",
            open && "rotate-180",
          )}
        />
      </button>

      {open && (
        <ul className="animate-fade-in border-t border-amber-200/70 px-4 py-2">
          {docs.map((d) => (
            <li key={d.travelerId}>
              <Link
                href={`/clientes/${d.contactId}`}
                className="flex min-h-11 items-center justify-between gap-3 py-1.5 tap-highlight-none"
              >
                <span className="min-w-0 truncate text-sm text-amber-900">
                  <span className="font-medium">{d.travelerName}</span>
                  {d.travelerName !== d.contactName && (
                    <span className="text-amber-700"> · grupo de {d.contactName}</span>
                  )}
                </span>
                <span
                  className={cn(
                    "shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-medium",
                    isExpired(d.expiry)
                      ? "border-red-200 bg-red-50 text-red-700"
                      : "border-amber-300 bg-amber-100 text-amber-800",
                  )}
                >
                  {isExpired(d.expiry) ? `venció ${fmtDate(d.expiry)}` : `vence ${fmtDate(d.expiry)}`}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
