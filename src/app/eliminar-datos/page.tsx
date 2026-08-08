import type { Metadata } from "next";
import {
  Bullets,
  LegalPage,
  Section,
  contactEmail,
  getAgencia,
} from "@/components/public/legal";
import { fmtPhone } from "@/lib/format";

/**
 * Instrucciones para eliminar los datos. Meta la exige para publicar la app
 * (App Dashboard → Configuración → Básica → Eliminación de datos de usuario) y
 * es la que mira si alguna vez revisa la app: tiene que ser una URL propia con
 * un procedimiento de verdad, no un link de relleno.
 *
 * Ruta pública: está en PUBLIC_PREFIXES del proxy, no pide sesión.
 */

export const metadata: Metadata = {
  title: "Eliminar mis datos",
  description: "Cómo pedir que borremos los datos personales que tenemos tuyos.",
};

const ULTIMA_ACTUALIZACION = "2026-08-08";

export const revalidate = 3600;

export default async function EliminarDatosPage() {
  const agencia = await getAgencia();
  const nombre = agencia?.name ?? "la agencia";
  const email = contactEmail(agencia);
  const telefono = agencia?.legal?.phone ?? agencia?.phone ?? null;

  const asunto = encodeURIComponent("Eliminación de mis datos");

  return (
    <LegalPage
      agencyName={nombre}
      title="Eliminar mis datos"
      updatedAt={ULTIMA_ACTUALIZACION}
    >
      <Section title="Qué podés pedir">
        <p>
          Podés pedirnos en cualquier momento que te digamos qué datos tuyos tenemos, que
          los corrijamos si están mal, o que los borremos. Es gratis y no hace falta que
          expliques por qué.
        </p>
      </Section>

      <Section title="Cómo se pide">
        <p>Elegí el camino que te quede más cómodo:</p>
        <Bullets
          items={[
            email ? (
              <>
                <strong className="font-medium text-ink">Por mail:</strong> escribinos a{" "}
                <a
                  href={`mailto:${email}?subject=${asunto}`}
                  className="font-medium text-brand-text underline underline-offset-2"
                >
                  {email}
                </a>{" "}
                con el asunto{" "}
                <span className="font-medium text-ink">
                  &ldquo;Eliminación de mis datos&rdquo;
                </span>
                .
              </>
            ) : (
              <>
                <strong className="font-medium text-ink">Por WhatsApp:</strong> respondé{" "}
                <span className="font-medium text-ink">BAJA</span> en el mismo chat por el
                que nos escribiste.
              </>
            ),
            <>
              <strong className="font-medium text-ink">Por WhatsApp o Instagram:</strong>{" "}
              mandanos un mensaje por el mismo canal por el que nos venías escribiendo y
              pedinos que borremos tus datos.
            </>,
            telefono ? (
              <>
                <strong className="font-medium text-ink">Por teléfono:</strong>{" "}
                {fmtPhone(telefono)}.
              </>
            ) : null,
          ].filter(Boolean)}
        />
        <p>
          Para poder identificarte, decinos el teléfono, el usuario de Instagram o el mail
          con el que nos contactaste. No te vamos a pedir ningún dato de más.
        </p>
      </Section>

      <Section title="Qué pasa después">
        <p>
          Te respondemos dentro de los{" "}
          <span className="font-medium text-ink">10 días hábiles</span> y borramos de
          nuestro sistema:
        </p>
        <Bullets
          items={[
            "Tu ficha de contacto: nombre, teléfono, email, usuario de Instagram y documento.",
            "Las conversaciones de WhatsApp y de Instagram que tuvimos con vos.",
            "Los presupuestos que te armamos y las consultas asociadas.",
            "Los datos de los pasajeros que hayas cargado y que no correspondan a un viaje ya facturado.",
          ]}
        />
      </Section>

      <Section title="Qué no podemos borrar">
        <p>
          Si ya hiciste un viaje con nosotros, la ley nos obliga a conservar los
          comprobantes de esa operación (facturas y registros contables) por el plazo que
          fija la normativa impositiva argentina. Eso queda archivado sin usarse para
          contactarte, y se elimina cuando vence ese plazo.
        </p>
        <p>
          Los mensajes que hayan quedado en tu propio celular, y lo que WhatsApp o
          Instagram guarden por su cuenta, no dependen de nosotros: eso se maneja desde tu
          cuenta en cada aplicación.
        </p>
      </Section>

      <Section title="Si no estás conforme">
        <p>
          En Argentina, la Ley 25.326 de Protección de Datos Personales te da derecho a
          acceder a tus datos, rectificarlos y pedir que los suprimamos. Si considerás que
          no cumplimos, podés hacer un reclamo ante la Agencia de Acceso a la Información
          Pública.
        </p>
      </Section>
    </LegalPage>
  );
}
