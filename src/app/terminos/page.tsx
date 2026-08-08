import type { Metadata } from "next";
import Link from "next/link";
import {
  Bullets,
  LegalPage,
  Section,
  contactEmail,
  getAgencia,
} from "@/components/public/legal";
import { fmtPhone } from "@/lib/format";

/**
 * Condiciones del servicio. Meta las pide para publicar la app (App Dashboard →
 * Configuración → Básica → URL de las Condiciones del servicio).
 *
 * Describen la relación entre la agencia y el pasajero — la agencia intermedia
 * entre el cliente y los prestadores (aerolíneas, hoteles, mayoristas), que es
 * lo que define su responsabilidad y lo que hay que decir sin vueltas.
 *
 * Ruta pública: está en PUBLIC_PREFIXES del proxy, no pide sesión.
 */

export const metadata: Metadata = {
  title: "Condiciones del servicio",
  description: "Las condiciones con las que contratás un viaje con nosotros.",
};

const ULTIMA_ACTUALIZACION = "2026-08-08";

export const revalidate = 3600;

export default async function TerminosPage() {
  const agencia = await getAgencia();
  const nombre = agencia?.name ?? "la agencia";
  const legal = agencia?.legal;
  const email = contactEmail(agencia);
  const telefono = legal?.phone ?? agencia?.phone ?? null;

  const domicilio = [legal?.address, legal?.city, legal?.province, legal?.country]
    .filter(Boolean)
    .join(", ");

  return (
    <LegalPage
      agencyName={nombre}
      title="Condiciones del servicio"
      updatedAt={ULTIMA_ACTUALIZACION}
    >
      <Section title="Quiénes somos">
        <p>
          {nombre}
          {legal?.legal_name ? (
            <>
              {" "}
              es el nombre comercial de{" "}
              <span className="font-medium text-ink">{legal.legal_name}</span>
            </>
          ) : null}
          {legal?.cuit ? <>, CUIT {legal.cuit}</> : null}
          {domicilio ? <>, con domicilio en {domicilio}</> : null}. Somos una agencia de
          viajes: intermediamos entre vos y los prestadores que efectivamente brindan cada
          servicio.
        </p>
        {legal?.evyt && (
          <p>
            Legajo EVyT <span className="font-medium text-ink">{legal.evyt}</span>, otorgado
            por el organismo nacional de turismo.
          </p>
        )}
      </Section>

      <Section title="Qué hacemos y qué no">
        <p>
          Armamos tu viaje, te cotizamos, reservamos y gestionamos la documentación. El
          servicio en sí —el vuelo, la habitación, la excursión, la asistencia al viajero—
          lo presta un tercero, y se rige por sus propias condiciones, que te informamos
          antes de que confirmes.
        </p>
        <Bullets
          items={[
            "Respondemos por nuestra gestión: la información que te damos, las reservas que hacemos y los pagos que administramos.",
            "No respondemos por hechos del prestador ni por caso fortuito o fuerza mayor: cancelaciones de vuelos, demoras, huelgas, clima o decisiones de un hotel o una aerolínea.",
            "Ante un problema en destino, te acompañamos en el reclamo frente al prestador.",
          ]}
        />
      </Section>

      <Section title="Presupuestos y precios">
        <Bullets
          items={[
            "Los presupuestos valen hasta la fecha que figura en cada uno y están sujetos a disponibilidad al momento de confirmar.",
            "Los precios pueden variar por cambios de tarifa del prestador, del tipo de cambio o de impuestos y tasas, mientras la reserva no esté pagada y confirmada.",
            "Salvo que se aclare lo contrario, los precios no incluyen gastos personales, propinas, excursiones opcionales ni trámites de visa.",
          ]}
        />
      </Section>

      <Section title="Reservas y pagos">
        <p>
          La reserva queda confirmada cuando se abona la seña acordada y el prestador la
          acepta. Los saldos se pagan en las fechas que figuran en tu file; si un saldo no
          se paga en término, el prestador puede cancelar la reserva y aplicar sus gastos.
        </p>
        <p>
          Emitimos comprobante por cada pago. No guardamos los datos de tu tarjeta: los
          maneja quien procesa el cobro.
        </p>
      </Section>

      <Section title="Cambios y cancelaciones">
        <p>
          Las condiciones de cambio y cancelación las fija cada prestador y te las
          informamos antes de confirmar. Sobre esos gastos podemos aplicar un cargo por
          gestión, que también te informamos antes.
        </p>
      </Section>

      <Section title="Tu responsabilidad como pasajero">
        <Bullets
          items={[
            "Verificar que tu documentación esté en regla: DNI o pasaporte vigente, visas y permisos de menores.",
            "Chequear que los nombres de los pasajeros coincidan exactamente con el documento antes de que emitamos. Corregir un nombre después de emitido tiene costo y a veces no es posible.",
            "Cumplir los horarios de presentación y las condiciones de cada servicio.",
            "Consultar los requisitos sanitarios del destino.",
          ]}
        />
      </Section>

      <Section title="Cómo nos comunicamos">
        <p>
          Te escribimos por WhatsApp, por Instagram o por mail, según el canal por el que
          nos hayas contactado, para responderte, mandarte presupuestos y avisarte de
          vencimientos y saldos. Podés pedirnos que dejemos de escribirte cuando quieras.
        </p>
        <p>
          Cómo tratamos tus datos está en la{" "}
          <Link
            href="/privacidad"
            className="font-medium text-brand-text underline underline-offset-2"
          >
            política de privacidad
          </Link>
          , y cómo pedir que los borremos, en{" "}
          <Link
            href="/eliminar-datos"
            className="font-medium text-brand-text underline underline-offset-2"
          >
            eliminar mis datos
          </Link>
          .
        </p>
      </Section>

      <Section title="Ley aplicable y contacto">
        <p>
          Estas condiciones se rigen por las leyes de la República Argentina. Ante cualquier
          consulta o reclamo, escribinos primero a nosotros: lo resolvemos más rápido que
          por cualquier otra vía.
        </p>
        <ul className="space-y-1">
          {email && <li className="text-ink">{email}</li>}
          {telefono && <li className="text-ink">{fmtPhone(telefono)}</li>}
          {legal?.website && <li className="text-ink">{legal.website}</li>}
          {domicilio && <li className="text-ink">{domicilio}</li>}
        </ul>
      </Section>
    </LegalPage>
  );
}
