import type { Metadata } from "next";
import Link from "next/link";
import { Bullets, LegalPage, Section, getAgencia } from "@/components/public/legal";
import { fmtPhone } from "@/lib/format";

/**
 * Política de privacidad pública. La exige Meta para publicar la app de
 * WhatsApp (App Dashboard → Configuración → Básica → URL de la política de
 * privacidad) y es la que ve el cliente antes de escribirle a la agencia.
 *
 * Ruta pública: está en PUBLIC_PREFIXES del proxy, no pide sesión.
 * Los datos de la agencia se leen con service role porque `agencies` tiene RLS
 * por membresía y acá no hay usuario logueado.
 */

export const metadata: Metadata = {
  title: "Política de privacidad",
  description:
    "Cómo tratamos los datos personales de quienes nos escriben y contratan viajes.",
};

/** La política cambia cuando cambia el sistema, no en cada deploy. */
const ULTIMA_ACTUALIZACION = "2026-07-31";

/** Se regenera cada hora: si el admin carga el mail de la agencia, aparece solo. */
export const revalidate = 3600;

export default async function PrivacidadPage() {
  const agencia = await getAgencia();
  const nombre = agencia?.name ?? "la agencia";
  const contactos = [
    agencia?.email,
    agencia?.phone ? fmtPhone(agencia.phone) : null,
    agencia?.address,
  ].filter(Boolean) as string[];

  return (
    <LegalPage agencyName={nombre} title="Política de privacidad" updatedAt={ULTIMA_ACTUALIZACION}>
      <Section title="De qué se trata esto">
        <p>
          {nombre} usa un sistema de gestión propio para atender consultas de viaje,
          armar presupuestos y organizar las ventas. Esta página explica, en criollo,
          qué datos tuyos guardamos, para qué los usamos y cómo pedirnos que los
          borremos.
        </p>
        <p>
          Si nos escribís por WhatsApp, nos dejás tus datos por la web o contratás un
          viaje con nosotros, esto te aplica.
        </p>
      </Section>

      <Section title="Qué datos guardamos">
        <p>Solo lo que hace falta para atenderte y para poder venderte un viaje:</p>
        <Bullets
          items={[
            <>
              <strong className="font-medium text-ink">Para contactarte:</strong> nombre,
              teléfono, email y, si nos escribís por WhatsApp, el nombre de tu perfil.
            </>,
            <>
              <strong className="font-medium text-ink">De la conversación:</strong> los
              mensajes que intercambiamos con vos por WhatsApp, para no hacerte repetir
              lo que ya contaste.
            </>,
            <>
              <strong className="font-medium text-ink">Del viaje:</strong> destino,
              fechas, cantidad de pasajeros y edades de los menores, para poder cotizar.
            </>,
            <>
              <strong className="font-medium text-ink">Para emitir:</strong> documento,
              fecha de nacimiento y vencimiento del pasaporte de cada pasajero, cuando el
              viaje se concreta y las aerolíneas o los mayoristas lo piden.
            </>,
            <>
              <strong className="font-medium text-ink">De los pagos:</strong> montos,
              fechas y forma de pago. <strong className="font-medium text-ink">No
              guardamos los datos de tu tarjeta</strong>: esos los maneja quien procesa
              el cobro.
            </>,
          ]}
        />
      </Section>

      <Section title="Para qué los usamos">
        <Bullets
          items={[
            "Responderte y hacerte el seguimiento de la consulta.",
            "Armarte presupuestos y mandártelos.",
            "Organizar tu viaje: reservas, pagos, documentación y avisos de salida.",
            "Avisarte si se te vence el pasaporte o si tenés un saldo pendiente.",
            "Cumplir con lo que nos exige la ley (facturación, registros contables).",
          ]}
        />
        <p>
          No vendemos tus datos ni se los pasamos a nadie para que te haga publicidad.
        </p>
      </Section>

      <Section title="WhatsApp">
        <p>
          Atendemos por WhatsApp usando la plataforma de Meta. Cuando nos escribís, Meta
          procesa ese mensaje para poder entregárnoslo, según{" "}
          <a
            href="https://www.whatsapp.com/legal/privacy-policy"
            target="_blank"
            rel="noopener noreferrer"
            className="font-medium text-brand-text underline underline-offset-2"
          >
            su propia política de privacidad
          </a>
          . Nosotros guardamos esa conversación en nuestro sistema para poder atenderte.
        </p>
        <p>
          Podés pedirnos que dejemos de escribirte cuando quieras: respondé{" "}
          <span className="font-medium text-ink">BAJA</span> en el mismo chat y listo.
        </p>
      </Section>

      <Section title="Con quién se comparten">
        <p>
          Con quienes hacen falta para que el viaje exista, y solo con lo necesario:
        </p>
        <Bullets
          items={[
            "Aerolíneas, hoteles, mayoristas y compañías de asistencia con las que reservamos tu viaje.",
            "Proveedores de tecnología que alojan el sistema (servidores y base de datos), bajo contrato y sin permiso para usar tus datos con otro fin.",
            "Organismos públicos, cuando una ley nos obliga.",
          ]}
        />
      </Section>

      <Section title="Cuánto tiempo los guardamos">
        <p>
          Mientras seas cliente y, después, el tiempo que nos exijan las obligaciones
          comerciales e impositivas. Pasado eso, los borramos o los dejamos sin
          posibilidad de identificarte.
        </p>
      </Section>

      <Section id="eliminar-datos" title="Cómo pedir que borremos tus datos">
        <p>
          Escribinos y listo. Podés pedirnos en cualquier momento que te digamos qué
          datos tuyos tenemos, que los corrijamos si están mal, o que los borremos.
        </p>
        <p>
          Para pedir la eliminación, mandanos un mensaje
          {agencia?.email ? (
            <>
              {" "}
              a{" "}
              <a
                href={`mailto:${agencia.email}?subject=Eliminación de mis datos`}
                className="font-medium text-brand-text underline underline-offset-2"
              >
                {agencia.email}
              </a>
            </>
          ) : (
            " a nuestro contacto"
          )}{" "}
          con el asunto <span className="font-medium text-ink">
            &ldquo;Eliminación de mis datos&rdquo;
          </span>{" "}
          y el teléfono o email con el que nos escribiste. Te respondemos dentro de los{" "}
          <span className="font-medium text-ink">10 días hábiles</span> y borramos todo
          lo que no estemos obligados a conservar por ley (por ejemplo, las facturas de
          un viaje que ya hiciste). El paso a paso está en{" "}
          <Link
            href="/eliminar-datos"
            className="font-medium text-brand-text underline underline-offset-2"
          >
            eliminar mis datos
          </Link>
          .
        </p>
      </Section>

      <Section title="Tus derechos">
        <p>
          En Argentina, la Ley 25.326 de Protección de Datos Personales te da derecho a
          acceder a tus datos, rectificarlos y pedir que los suprimamos. La Agencia de
          Acceso a la Información Pública es el organismo de control y podés hacerle un
          reclamo si considerás que no cumplimos.
        </p>
      </Section>

      <Section title="Contacto">
        {contactos.length > 0 ? (
          <ul className="space-y-1">
            {contactos.map((c) => (
              <li key={c} className="text-ink">
                {c}
              </li>
            ))}
          </ul>
        ) : (
          <p>
            Escribinos por el mismo WhatsApp por el que nos contactaste y te
            respondemos.
          </p>
        )}
        <p>
          Si cambiamos algo importante de esta política, actualizamos la fecha de arriba.
        </p>
      </Section>
    </LegalPage>
  );
}
