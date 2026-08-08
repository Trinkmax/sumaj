/**
 * Sacar un teléfono de un mensaje escrito por una persona.
 *
 * Existe por una sola razón: en Instagram no tenemos el teléfono de nadie, pero
 * la gente lo escribe sola ("mi whats es 381 555-4433"). Con ese número el
 * operador puede seguir la charla por WhatsApp, que es donde la agencia vende.
 *
 * ─────────────────────────────────────────────
 * POR QUÉ ES CONSERVADOR
 *
 * Del otro lado de esta función puede salir un WhatsApp automático. Un falso
 * positivo no es un bug silencioso: es un mensaje a un desconocido. Así que la
 * regla es al revés de lo habitual — ante la duda, `null`. Concretamente:
 *
 *   · Se exigen 10 dígitos como mínimo. Un DNI argentino tiene 8 y un precio
 *     tiene menos: quedan afuera por construcción, sin heurísticas frágiles.
 *   · Un número local tiene que quedar EXACTO en 10 dígitos después de sacarle
 *     el 0 y el 15. Si quedan 9 u 11, algo no cerró y no se devuelve nada.
 *   · Los separadores aceptados son los que usa la gente (espacios, guiones,
 *     puntos, paréntesis). Nada de inventar.
 *
 * ─────────────────────────────────────────────
 * ARGENTINA
 *
 * El formato local (0381 15 555-4433) tiene dos cosas que E.164 no quiere: el 0
 * de larga distancia y el 15 de celular. Y le falta una: el 9 que va después del
 * 54 para los móviles. Sin ese 9, WhatsApp no entrega el mensaje. Todo eso pasa
 * solo cuando el código de país es 54; para cualquier otro país se arma
 * `código + número` sin tocar nada, que es lo que corresponde.
 */

/** Largo del número local argentino sin 0 y sin 15: área + abonado. */
const AR_LOCAL_DIGITS = 10;

/**
 * Candidatos a teléfono dentro de un texto libre. Arranca y termina en dígito y
 * en el medio acepta lo que la gente escribe de verdad.
 */
const CANDIDATE_RE = /\+?\d[\d\s().\-]{8,22}\d/g;

/** E.164 razonable: entre 11 y 15 dígitos. */
function looksLikeE164(digits: string): boolean {
  return digits.length >= 11 && digits.length <= 15;
}

/**
 * Normaliza a E.164 sin '+' (el formato que usa toda la app: `contacts.phone`,
 * `wa_channels.phone`, wa.me).
 *
 * @param raw       lo que escribió la persona
 * @param countryCode código de país por default, sin '+' ("54")
 * @returns E.164 sin '+' o null si no se pudo resolver con confianza
 */
export function toE164(raw: string, countryCode = "54"): string | null {
  const cc = countryCode.replace(/\D/g, "") || "54";
  const trimmed = raw.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  // ¿Vino en formato internacional? Solo si lo dice de verdad: un '+' adelante,
  // un '00' de prefijo internacional, o directamente el código de país delante
  // de un número que ya tiene largo de internacional. En ese caso el código de
  // país ya está adentro y NO se antepone el default: alguien que escribe
  // "+1 415 555 1234" está dando un número de Estados Unidos, no uno argentino.
  const explicitIntl = trimmed.startsWith("+") || digits.startsWith("00");
  const body = digits.startsWith("00") ? digits.slice(2) : digits;

  if (explicitIntl || (body.startsWith(cc) && body.length > AR_LOCAL_DIGITS + 1)) {
    const intl = normalizeArMobile(body, cc);
    return looksLikeE164(intl) ? intl : null;
  }

  // Local. Se le saca el 0 de larga distancia y el 15 de celular.
  let local = body.replace(/^0+/, "");
  // El 15 suma DOS dígitos: "0381 15 555-4433" queda en 12 después de sacarle el
  // 0, no en 11. Va pegado después del código de área, que en Argentina tiene 2,
  // 3 o 4 dígitos — y un número local de 12 dígitos no existe de otra forma.
  if (cc === "54" && local.length === AR_LOCAL_DIGITS + 2) {
    const withoutFifteen = local.replace(/^(\d{2,4})15(\d+)$/, "$1$2");
    if (withoutFifteen.length === AR_LOCAL_DIGITS) local = withoutFifteen;
  }
  if (local.length !== AR_LOCAL_DIGITS) return null;

  return normalizeArMobile(`${cc}${local}`, cc);
}

/**
 * El 9 de los móviles argentinos. WhatsApp no entrega a un 54 + 10 dígitos sin
 * el 9 en el medio, y es el error más silencioso de todos: la API acepta el
 * envío y el mensaje no llega nunca.
 */
function normalizeArMobile(e164: string, cc: string): string {
  // El chequeo es sobre el número, no solo sobre el default de la agencia: una
  // agencia argentina puede recibir un +1 y ahí no hay ningún 9 que agregar.
  if (cc !== "54" || !e164.startsWith("54")) return e164;
  const rest = e164.slice(2);
  if (rest.length === AR_LOCAL_DIGITS && !rest.startsWith("9")) return `549${rest}`;
  return e164;
}

/**
 * El primer teléfono que aparece en un mensaje, o null.
 *
 * Devuelve el PRIMERO y no todos a propósito: si alguien escribe dos números, el
 * sistema no tiene forma de saber cuál es el suyo, y esa decisión la toma el
 * vendedor mirando el chat — no una heurística.
 */
export function extractPhone(text: string | null | undefined, countryCode = "54"): string | null {
  if (!text) return null;
  for (const match of text.matchAll(CANDIDATE_RE)) {
    const candidate = match[0];
    // Menos de 10 dígitos no es un teléfono que podamos usar (y sí puede ser un
    // DNI, un precio o una fecha).
    if (candidate.replace(/\D/g, "").length < AR_LOCAL_DIGITS) continue;
    const phone = toE164(candidate, countryCode);
    if (phone) return phone;
  }
  return null;
}
