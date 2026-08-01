import type { Metadata } from "next";
import { createAdminClient, hasAdminClient } from "@/lib/supabase/admin";
import { CopyValue } from "@/components/public/copy-value";
import type { AgencySettings } from "@/lib/types";

/**
 * Ficha pública con los datos registrales de la agencia.
 *
 * Existe porque los terceros que piden corroborar estos datos —Meta al verificar
 * el negocio, un mayorista al abrir cuenta, un banco— quieren verlos en una URL
 * que sea del titular, no en una captura de pantalla. Muchas agencias no pueden
 * tocar su sitio institucional (lo hizo un tercero), así que esta página es el
 * lugar que sí controlan.
 *
 * Ruta pública: está en PUBLIC_PREFIXES del proxy, no pide sesión. Los datos se
 * leen con service role porque `agencies` tiene RLS por membresía y acá no hay
 * usuario logueado. Solo se publica lo que ya es información registral de una
 * sociedad (razón social, CUIT, domicilio legal, contacto): nada de clientes,
 * ventas ni equipo.
 */

export const metadata: Metadata = {
  title: "Datos de la empresa",
  description: "Razón social, CUIT y domicilio legal.",
};

/** Se regenera cada hora: si el admin corrige un dato, aparece solo. */
export const revalidate = 3600;

type Agencia = {
  name: string;
  logo_url: string | null;
  email: string | null;
  phone: string | null;
  settings: AgencySettings | null;
};

async function getAgencia(): Promise<Agencia | null> {
  if (!hasAdminClient()) return null;
  const { data } = await createAdminClient()
    .from("agencies")
    .select("name, logo_url, email, phone, settings")
    .order("created_at", { ascending: true })
    .limit(1)
    .maybeSingle();
  return (data as Agencia | null) ?? null;
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-line py-3 last:border-b-0">
      <dt className="shrink-0 pt-0.5 text-[13px] text-ink-faint">{label}</dt>
      <dd className="flex min-w-0 items-start gap-2">
        <span className="min-w-0 break-words text-right text-[15px] font-medium text-ink">
          {value}
        </span>
        <CopyValue value={value} label={label} />
      </dd>
    </div>
  );
}

export default async function EmpresaPage() {
  const agencia = await getAgencia();
  const legal = agencia?.settings?.legal ?? {};

  // el domicilio se arma con lo que haya cargado, sin comas huérfanas
  const domicilio = [
    legal.address,
    [legal.postal_code, legal.city].filter(Boolean).join(" "),
    legal.province,
    legal.country,
  ]
    .map((p) => p?.trim())
    .filter(Boolean)
    .join(", ");

  const rows: { label: string; value: string }[] = [
    { label: "Razón social", value: legal.legal_name ?? "" },
    { label: "CUIT", value: legal.cuit ?? "" },
    { label: "Domicilio legal", value: domicilio },
    { label: "Legajo EVyT", value: legal.evyt ?? "" },
    { label: "Teléfono", value: legal.phone ?? agencia?.phone ?? "" },
    { label: "Email", value: legal.email ?? agencia?.email ?? "" },
    { label: "Sitio web", value: legal.website ?? "" },
  ].filter((r) => r.value.trim().length > 0);

  const nombreComercial = agencia?.name?.trim() ?? "";
  const distintoDelLegal =
    nombreComercial.length > 0 &&
    nombreComercial.toLowerCase() !== (legal.legal_name ?? "").trim().toLowerCase();

  return (
    <main className="mx-auto min-h-dvh max-w-xl px-5 py-12 sm:py-16">
      <header className="flex flex-col items-center text-center">
        {/* <img> y no next/image: el resto del repo hace lo mismo y el logo vive
            en el storage de Supabase, que no está en remotePatterns */}
        {agencia?.logo_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={agencia.logo_url}
            alt={nombreComercial || "Logo"}
            className="mb-5 h-14 w-auto object-contain"
          />
        )}
        <h1 className="font-display text-2xl font-semibold text-ink sm:text-3xl">
          Datos de la empresa
        </h1>
        {distintoDelLegal && (
          <p className="mt-1.5 text-sm text-ink-soft">
            {nombreComercial} opera bajo la razón social que figura abajo.
          </p>
        )}
      </header>

      {rows.length > 0 ? (
        <>
          <dl className="card mt-8 px-5 py-1">
            {rows.map((r) => (
              <Row key={r.label} label={r.label} value={r.value} />
            ))}
          </dl>
          <p className="mt-5 text-center text-[13px] leading-relaxed text-ink-faint">
            Información registral publicada por su titular. Si necesitás
            corroborarla, este link es la fuente.
          </p>
        </>
      ) : (
        <p className="card mt-8 px-5 py-8 text-center text-sm leading-relaxed text-ink-soft">
          Todavía no se cargaron los datos registrales. Un admin los completa en
          Configuración → Agencia y aparecen acá.
        </p>
      )}
    </main>
  );
}
