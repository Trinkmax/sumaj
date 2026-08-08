/**
 * El puente entre Instagram y WhatsApp.
 *
 * Instagram sirve para que la consulta ENTRE; WhatsApp es donde la agencia
 * vende: ahí está el teléfono, el número de la sucursal y el seguimiento sin
 * ventana de 24 hs. Este archivo es lo que hace que pasar de uno al otro no
 * pierda la persona en el camino.
 *
 * ─────────────────────────────────────────────
 * EL PROBLEMA QUE RESUELVE
 *
 * La respuesta automática del DM le ofrece al cliente un link `wa.me`. El
 * cliente lo toca y aparece en el WhatsApp de la agencia… como un desconocido:
 * del lado de WhatsApp lo único que llega es un teléfono, que no tiene NADA que
 * ver con el IGSID de Instagram. Sin más, el CRM termina con dos contactos y dos
 * leads de la misma persona, y el vendedor tiene que darse cuenta solo.
 *
 * La solución es la única pieza de información que viaja con el cliente: el
 * texto prellenado del link. Ahí va una referencia corta —`Ref. IG-3F7A9C21`— y
 * cuando ese WhatsApp entra, el webhook la reconoce y sigue en el MISMO contacto
 * y el MISMO lead.
 *
 * Es deliberadamente frágil de una sola forma: si el cliente borra el texto, no
 * hay referencia y se crea un contacto nuevo, exactamente como pasaba antes. El
 * puente mejora el caso normal y nunca empeora el caso raro.
 */
import type { SupabaseClient } from "@supabase/supabase-js";
import { waLink } from "@/lib/domain";
import type { Database } from "@/lib/database.types";

type Admin = SupabaseClient<Database>;

/**
 * Cómo se ve la referencia en el mensaje del cliente. El prefijo `IG-` la hace
 * reconocible de un vistazo (y evita que un código de reserva cualquiera de 8
 * caracteres se confunda con esto).
 */
const CODE_RE = /\bIG-([0-9A-F]{8})\b/i;

export function bridgeRef(code: string): string {
  return `IG-${code}`;
}

/**
 * El texto que le queda escrito al cliente en WhatsApp.
 * La referencia va en su propio renglón y con un punto: leído por una persona
 * parece lo que es —un número de referencia— y no un error de tipeo.
 */
export function bridgeMessage(text: string, code: string | null): string {
  const clean = text.trim();
  return code ? `${clean}\n\nRef. ${bridgeRef(code)}` : clean;
}

/** El link que se le manda al cliente por el DM. */
export function bridgeUrl(phone: string, text: string, code: string | null): string {
  return waLink(phone, bridgeMessage(text, code));
}

/**
 * Crea la referencia para este contacto. Devuelve null si no se pudo (y el
 * puente sigue funcionando sin ella: el cliente llega igual a WhatsApp, solo que
 * como contacto nuevo).
 */
export async function createBridgeLink(
  supabase: Admin,
  input: {
    agencyId: string;
    contactId: string;
    conversationId: string | null;
    leadId: string | null;
  },
): Promise<string | null> {
  const { data } = await supabase
    .from("ig_bridge_links")
    .insert({
      agency_id: input.agencyId,
      contact_id: input.contactId,
      conversation_id: input.conversationId,
      lead_id: input.leadId,
    })
    .select("code")
    .single();
  return data?.code ?? null;
}

/** La referencia que traiga el texto de un WhatsApp entrante, si trae alguna. */
export function findBridgeCode(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = CODE_RE.exec(text);
  return match ? match[1].toUpperCase() : null;
}

export type BridgeMatch = {
  contactId: string;
  leadId: string | null;
  /** el hilo de Instagram del que venía */
  igConversationId: string | null;
};

/**
 * Canjea una referencia: devuelve a quién pertenece y la marca como usada.
 *
 * Tres condiciones, y las tres importan:
 *   · La agencia tiene que ser la misma. La referencia llega en un texto que
 *     escribe cualquiera: sin este filtro, un código de otra agencia haría que un
 *     WhatsApp entrante se pegue al contacto de un tenant ajeno.
 *   · No puede estar vencida (30 días). Un código viejo copiado en un mensaje
 *     cualquiera no puede fusionar contactos para siempre.
 *   · Se puede canjear una sola vez. `used_at` se escribe con la condición
 *     `is null` en el propio UPDATE, así que si dos mensajes entran a la vez uno
 *     solo gana: sin eso, dos personas que reenvían el mismo texto terminan
 *     siendo el mismo contacto.
 */
export async function redeemBridgeLink(
  supabase: Admin,
  agencyId: string,
  code: string,
  waConversationId: string | null,
): Promise<BridgeMatch | null> {
  const { data } = await supabase
    .from("ig_bridge_links")
    .update({ used_at: new Date().toISOString(), wa_conversation_id: waConversationId })
    .eq("code", code)
    .eq("agency_id", agencyId)
    .is("used_at", null)
    .gt("expires_at", new Date().toISOString())
    .select("contact_id, lead_id, conversation_id")
    .maybeSingle();

  if (!data) return null;
  return {
    contactId: data.contact_id,
    leadId: data.lead_id,
    igConversationId: data.conversation_id,
  };
}

/**
 * Devuelve la referencia al ruedo.
 *
 * Se usa cuando el canje salió bien pero NO se puede aplicar — el caso típico es
 * que el teléfono del que llega el WhatsApp ya identifique a otra persona del
 * CRM (alguien reenvió el texto con la referencia adentro). Sin esto, ese
 * reenvío quemaría el código y la persona que de verdad lo recibió por Instagram
 * terminaría como un contacto duplicado cuando toque su propio link.
 */
export async function releaseBridgeLink(supabase: Admin, code: string): Promise<void> {
  await supabase
    .from("ig_bridge_links")
    .update({ used_at: null, wa_conversation_id: null })
    .eq("code", code);
}

/**
 * Deja anotado en qué hilo de WhatsApp terminó el puente.
 *
 * Va aparte del canje porque el canje tiene que ser lo PRIMERO que pasa —es lo
 * que decide de quién es el mensaje— y en ese momento todavía no existe la
 * conversación de WhatsApp. Separarlo mantiene el canje atómico (una sola
 * persona se queda con la referencia) sin tener que adivinar el hilo antes de
 * crearlo.
 */
export async function attachBridgeConversation(
  supabase: Admin,
  code: string,
  waConversationId: string,
): Promise<void> {
  await supabase
    .from("ig_bridge_links")
    .update({ wa_conversation_id: waConversationId })
    .eq("code", code);
}
