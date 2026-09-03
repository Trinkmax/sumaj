import { isJidUser, isLidUser } from "@whiskeysockets/baileys";
import { readState, readStateAnyChannel, writeState, writeStateMany } from "./supabase.js";

/**
 * LID → teléfono, por sesión.
 *
 * Desde 2025 WhatsApp entrega los chats 1:1 con `remoteJid` "<lid>@lid" (Linked
 * ID) en vez de "<teléfono>@s.whatsapp.net" — visto en producción:
 * "24623097851954@lid". El teléfono viaja aparte, en `key.senderPn`, y NO
 * siempre: en un mensaje escrito desde el celular de la sucursal `senderPn` es
 * el propio número, y hay stanzas que no lo traen. Sin este mapa, la app
 * recibiría un `from` vacío para una persona que ayer escribió con número.
 *
 * Se alimenta de todo lo que junta las dos identidades: el `senderPn`/`senderLid`
 * de los mensajes, `sock.onWhatsApp()` (devuelve {jid, exists, lid}), el evento
 * `chats.phoneNumberShare` y las filas de `contacts.upsert/update` que traen
 * lid + jid. Persiste en wa_session_state bajo "lid-<lid>" → { pn } (mismo
 * almacén service-role que las credenciales, sin migración) para sobrevivir
 * reinicios; en memoria se cachea para no ir a la base por cada mensaje.
 *
 * La escritura es por canal (la fila es de la sesión que lo aprendió), pero la
 * lectura cae a cualquier canal: el LID de una persona es el mismo la mire la
 * sucursal que la mire, así que lo que juntó Casa central le sirve a Nueva
 * Córdoba el día que la misma persona le escribe por LID.
 *
 * Baileys 6.7.23 no trae un store de LIDs propio: esto es lo que hay.
 */
export class LidBook {
  private readonly cache = new Map<string, string>();
  /** LIDs consultados a la base y que no estaban: no volver a preguntar en esta corrida */
  private readonly misses = new Set<string>();

  constructor(private readonly channelId: string) {}

  /** Guarda el par si aporta algo nuevo. Acepta jids o dígitos pelados. */
  async remember(lidLike: string | null | undefined, pnLike: string | null | undefined): Promise<void> {
    const pair = this.learn(lidLike, pnLike);
    if (!pair) return;
    await writeState(this.channelId, `lid-${pair.lid}`, { pn: pair.pn });
  }

  /**
   * Una tanda de contactos, cada uno como sus jids sin saber cuál es cuál (los
   * eventos de contactos traen `id` en un formato y `lid`/`jid` en otro): se
   * guarda cada par que tenga uno de cada, y todos en UN viaje a la base.
   * `contacts.upsert` al abrir la sesión trae la agenda completa del celular:
   * cientos de contactos, y un upsert por cada uno eran cientos de requests
   * concurrentes sin nadie esperándolas.
   */
  async rememberManyJids(items: (string | null | undefined)[][]): Promise<void> {
    const rows = new Map<string, { channel_id: string; key: string; value: { pn: string } }>();
    for (const jids of items) {
      const pair = pairOf(jids);
      if (!pair) continue;
      const learned = this.learn(pair.lid, pair.pn);
      if (learned) rows.set(learned.lid, { channel_id: this.channelId, key: `lid-${learned.lid}`, value: { pn: learned.pn } });
    }
    if (rows.size > 0) await writeStateMany([...rows.values()]);
  }

  async resolve(lidLike: string | null | undefined): Promise<string | null> {
    const lid = digitsOf(lidLike);
    if (!lid) return null;
    const cached = this.cache.get(lid);
    if (cached) return cached;
    if (this.misses.has(lid)) return null;
    const key = `lid-${lid}`;
    // primero lo que aprendió esta sesión; si no, lo que aprendió cualquier otra
    const row = (await readState<{ pn?: string }>(this.channelId, key)) ?? (await readStateAnyChannel<{ pn?: string }>(key));
    const pn = digitsOf(row?.pn);
    if (pn) {
      this.cache.set(lid, pn);
      return pn;
    }
    this.misses.add(lid);
    return null;
  }

  /** Anota el par en memoria; devuelve los dígitos si hay que persistirlo (null = ya lo sabíamos o no sirve). */
  private learn(lidLike: string | null | undefined, pnLike: string | null | undefined): { lid: string; pn: string } | null {
    const lid = digitsOf(lidLike);
    const pn = digitsOf(pnLike);
    if (!lid || !pn) return null;
    if (this.cache.get(lid) === pn) return null;
    this.cache.set(lid, pn);
    this.misses.delete(lid);
    return { lid, pn };
  }
}

/** De un montón de jids, el que es LID y el que es teléfono (si están los dos). */
function pairOf(jids: (string | null | undefined)[]): { lid: string; pn: string } | null {
  const lid = jids.find((j) => j && isLidUser(j));
  const pn = jids.find((j) => j && isJidUser(j));
  return lid && pn ? { lid, pn } : null;
}

/** "5493511234567:12@s.whatsapp.net" → "5493511234567"; "123@lid" → "123". */
export function digitsOf(value: string | null | undefined): string {
  if (!value) return "";
  return value.split("@")[0]!.split(":")[0]!.replace(/\D/g, "");
}
