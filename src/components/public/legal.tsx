/**
 * Piezas compartidas de las páginas legales públicas (/privacidad, /terminos,
 * /eliminar-datos).
 *
 * Las tres las exige Meta para publicar la app (App Dashboard → Configuración →
 * Básica) y las tres las lee un cliente real, no un abogado: mismo layout, mismo
 * tono, mismos datos de la agencia. Salieron de privacidad/page.tsx cuando
 * aparecieron las otras dos — tres copias del mismo header era garantía de que
 * en un mes tuvieran datos distintos.
 *
 * SIN "use client": son Server Components y `getAgencia()` usa service role.
 */
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { fmtDateLong } from "@/lib/format";
import type { AgencySettings } from "@/lib/types";

export type Agencia = {
  name: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  legal: AgencySettings["legal"];
};

/**
 * La agencia del deploy. Se lee con service role porque `agencies` tiene RLS por
 * membresía y en estas páginas no hay usuario logueado.
 */
export async function getAgencia(): Promise<Agencia | null> {
  if (!hasAdminClient()) return null;
  const { data } = await createAdminClient()
    .from("agencies")
    .select("name, email, phone, address, settings")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  const settings = (data.settings ?? {}) as AgencySettings;
  return {
    name: data.name,
    email: data.email,
    phone: data.phone,
    address: data.address,
    legal: settings.legal,
  };
}

/** El mail al que se le escribe: el comercial, y si no hay, el de los papeles. */
export function contactEmail(agencia: Agencia | null): string | null {
  return agencia?.email ?? agencia?.legal?.email ?? null;
}

export function Section({
  id,
  title,
  children,
}: {
  id?: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-8">
      <h2 className="font-display text-xl font-semibold text-ink sm:text-2xl">{title}</h2>
      <div className="mt-2.5 space-y-3 text-[15px] leading-relaxed text-ink-soft">
        {children}
      </div>
    </section>
  );
}

export function Bullets({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="space-y-1.5">
      {items.map((item, i) => (
        <li key={i} className="flex gap-2.5">
          <span className="mt-[9px] size-1.5 shrink-0 rounded-full bg-brand-500" aria-hidden />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

/** El marco: nombre de la agencia, título, fecha y el pie. */
export function LegalPage({
  agencyName,
  title,
  updatedAt,
  children,
}: {
  agencyName: string;
  title: string;
  /** ISO date; cambia cuando cambia el texto, no en cada deploy */
  updatedAt: string;
  children: React.ReactNode;
}) {
  return (
    <main className="min-h-dvh bg-cream">
      <div className="mx-auto w-full max-w-2xl px-5 py-12 sm:px-8 sm:py-16">
        <header>
          <p className="text-[11px] font-medium uppercase tracking-[0.24em] text-brand-text">
            {agencyName}
          </p>
          <h1 className="mt-2 font-display text-3xl font-semibold leading-tight text-ink sm:text-4xl">
            {title}
          </h1>
          <p className="mt-3 text-sm text-ink-faint">
            Última actualización: {fmtDateLong(updatedAt)}
          </p>
        </header>

        <div className="mt-8 space-y-8 border-t border-line pt-8">{children}</div>

        <footer className="mt-12 border-t border-line pt-6">
          <p className="text-[11px] uppercase tracking-[0.2em] text-ink-faint">
            hecho con viajerOS
          </p>
        </footer>
      </div>
    </main>
  );
}
