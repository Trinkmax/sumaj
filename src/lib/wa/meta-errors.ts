/**
 * Los errores de la Cloud API, en criollo.
 *
 * Meta contesta en inglés y con un número adelante: "(#131058) Hello World
 * templates can only be sent from the Public Test Numbers". Eso llegaba tal cual
 * al toast del vendedor, que no tiene por qué saber qué es un Public Test Number
 * ni qué hacer al respecto. Acá cada código conocido se traduce a UNA frase que
 * dice qué pasó y QUÉ HACER; lo que no reconocemos vuelve tal cual, porque un
 * error sin traducir es mucho mejor que un "algo salió mal".
 *
 * SOLO SERVIDOR y sin dependencias: lo usa `cloud.ts` en el único punto por el
 * que pasan todos los envíos, así que el chat, las difusiones, el seguimiento y
 * la respuesta automática hablan el mismo idioma sin que cada uno traduzca.
 *
 * El texto original NO se pierde: `CloudResult` lo devuelve aparte en `raw`, y
 * ahí es donde hay que mirar cuando algo no cierra.
 */

/**
 * Códigos de Meta que sabemos leer. Solo están los que vimos o los que están
 * documentados sin ambigüedad: inventar una traducción para un código que no
 * conocemos manda a la agencia a arreglar el problema equivocado.
 *
 * Referencia: developers.facebook.com/docs/whatsapp/cloud-api/support/error-codes
 */
const MENSAJES: Record<number, string> = {
  /* ── La cuenta y el token ── */
  190: "El token de Meta venció o lo revocaron. Cargá uno nuevo en Configuración → WhatsApp.",
  200: "Al token de Meta le faltan permisos para mandar mensajes. Revisalo en Configuración → WhatsApp.",
  10: "Al token de Meta le faltan permisos para mandar mensajes. Revisalo en Configuración → WhatsApp.",
  133010:
    "El número madre no está registrado en la Cloud API. Terminá el alta en Configuración → WhatsApp.",
  131031:
    "Meta bloqueó la cuenta de WhatsApp del negocio. Entrá al Business Manager para ver el motivo: desde el sistema no se puede destrabar.",
  131042:
    "Meta no puede cobrar los envíos: falta el método de pago de la cuenta de WhatsApp Business. Cargalo en el Business Manager.",
  368: "Meta bloqueó el número por un tiempo por incumplir sus políticas. Hay que esperar a que lo libere.",

  /* ── La plantilla ── */
  131058:
    "«Hello world» es la plantilla de ejemplo de Meta y solo se puede mandar desde sus números de prueba. Creá una plantilla propia en Configuración → Plantillas.",
  132000:
    "La plantilla espera otra cantidad de variables de las que mandamos. Abrí la plantilla, revisá las {{variables}} del texto y volvé a mandarla a aprobar.",
  132001:
    "Esa plantilla no existe en Meta con ese idioma. Mandala a aprobar desde Configuración → Plantillas y esperá el visto bueno.",
  132005:
    "El texto quedó más largo de lo que Meta acepta para esa plantilla. Recortalo y volvé a mandarla a aprobar.",
  132007:
    "El texto de la plantilla no cumple el formato de Meta (saltos de línea, espacios de más o caracteres raros en una variable).",
  132012:
    "Un valor de las variables no tiene el formato que Meta aprobó para esa plantilla. Revisá los ejemplos y volvé a mandarla a aprobar.",
  132015:
    "Meta pausó esa plantilla por baja calidad: la gente la marcó como spam o la bloqueó. No se puede usar hasta que la libere.",
  132016:
    "Meta deshabilitó esa plantilla definitivamente por baja calidad. Hay que armar una nueva con otro texto.",

  /* ── La entrega ── */
  131047:
    "Pasaron más de 24 hs desde el último mensaje del cliente: fuera de esa ventana WhatsApp solo deja mandar una plantilla aprobada.",
  131026:
    "WhatsApp no pudo entregar el mensaje. Suele ser que el número no tiene WhatsApp o está mal escrito.",
  131021: "Ese es el mismo número desde el que mandás: WhatsApp no deja escribirse a uno mismo.",
  131045:
    "El número madre no terminó de registrarse en Meta. Volvé a Configuración → WhatsApp y completá el alta.",
  131048:
    "Meta frenó el envío porque el número viene recibiendo muchos reportes de spam. Bajá el ritmo unos días.",
  131049:
    "Meta decidió no entregar este mensaje para cuidar la experiencia de la persona. Pasa con los de marketing y no se puede forzar.",
  130472:
    "Meta no entregó el mensaje: esa persona está en un grupo con el que limita los mensajes de marketing.",

  /* ── El pedido ── */
  131008: "Falta un dato que Meta pide para este mensaje.",
  131009: "Meta rechazó uno de los valores del mensaje.",
  131016: "El servicio de WhatsApp de Meta está caído en este momento. Probá de nuevo en un rato.",
  131000: "Meta tuvo un error interno con este mensaje. Probá de nuevo en un minuto.",
  131052: "WhatsApp no pudo bajar el archivo adjunto.",
  131053: "WhatsApp no aceptó el archivo adjunto: fijate el formato y el peso.",

  /* ── El ritmo ── */
  4: "Se llegó al tope de mensajes por hora de Meta. Se reanuda solo en un rato.",
  80007: "Se llegó al tope de pedidos a Meta. Se reanuda solo en un rato.",
  130429:
    "Se llegó al tope de mensajes por segundo de Meta. Se reanuda solo en un rato.",
};

/**
 * Meta manda el código dentro del texto —"(#131058) Hello World…"— incluso
 * cuando el JSON no trae `error.code`. Sacarlo de ahí es la red por si el
 * payload viene distinto de lo que esperábamos.
 */
function codigoEnElTexto(raw: string): number | null {
  const m = raw.match(/\(#(\d{1,7})\)/);
  return m ? Number(m[1]) : null;
}

/**
 * El texto que ve el vendedor. `raw` es lo que dijo Meta y `code` lo que trajo
 * el JSON; si no reconocemos el código devolvemos `raw` sin tocar.
 */
export function errorDeMeta(raw: string, code: number | null): string {
  const codigo = code ?? codigoEnElTexto(raw);
  if (codigo != null && MENSAJES[codigo]) return MENSAJES[codigo];

  /* El 100 es el cajón de sastre de Meta: significa "parámetro inválido" y
     puede ser cualquier cosa, así que no se traduce en seco. Cuando el detalle
     menciona la plantilla, que es el caso que vimos, se dice eso; si no, viaja
     el texto original. */
  if (codigo === 100 && /template/i.test(raw)) {
    return "Meta no reconoció la plantilla. Revisá que esté aprobada y con el mismo idioma en Configuración → Plantillas.";
  }

  return raw;
}
