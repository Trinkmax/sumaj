/**
 * Consejos y frases del día para el inicio.
 * Mezcla de consejos operativos de venta de viajes y mensajes motivadores,
 * en rioplatense, cortos y sin cursilería. SIN emojis (van en la UI).
 *
 * La elección es determinística: día del año + hash del member id.
 * Así cada persona ve una frase distinta, pero estable durante todo el día
 * (nada de Math.random en render — el server y el cliente ven lo mismo).
 */
export const CONSEJOS: string[] = [
  "Respondé en menos de 5 minutos: el lead caliente se enfría rápido.",
  "El que pregunta por precio ya se imaginó el viaje. Ayudalo a decidirse.",
  "Un seguimiento a tiempo vale más que diez promociones.",
  "Hoy es buen día para reflotar un presupuesto dormido.",
  "Cerrá el día con el pipeline limpio: mañana arrancás liviano.",
  "Vender viajes es vender ganas. Contá el destino, no el itinerario.",
  "El silencio del cliente no es un no: es un «recordame por qué».",
  "Antes de cotizar, preguntá fechas y cuántos viajan. Ahorra idas y vueltas.",
  "Un audio cálido cierra más que tres párrafos perfectos.",
  "Al que volvió de viaje, escribile. Ahí nace el próximo.",
  "Cobrá la seña: una reserva sin plata es un lindo deseo.",
  "Mandá el presupuesto con nombre y fecha: lo genérico no emociona.",
  "Mate en mano y a la carga: los leads no se atienden solos.",
  "La confianza se construye respondiendo, no prometiendo.",
  "Preguntá qué sueña, no qué busca. Ahí está la venta.",
  "Menos pestañas abiertas, más llamadas hechas.",
  "El mejor momento para pedir un referido es cuando te dicen gracias.",
  "Cada no te deja más cerca del que sí viaja.",
  "Atendé los seguimientos que vencen hoy antes de abrir Instagram.",
  "Hablale al cliente como a un amigo que sabe menos de viajes que vos.",
  "La letra chica aclarada a tiempo te ahorra el reclamo de después.",
  "Si el día viene pesado, empezá por lo que más plata mueve.",
  "Los cumpleaños del mes son la excusa perfecta para volver a escribir.",
  "La constancia le gana al talento, sobre todo los lunes.",
];

/** Índice estable por día del año + member id (sin aleatoriedad en render). */
export function consejoDelDia(memberId: string, date: Date): string {
  const startOfYear = new Date(date.getFullYear(), 0, 1);
  const dayOfYear = Math.floor(
    (date.getTime() - startOfYear.getTime()) / 86_400_000,
  );
  let hash = 0;
  for (let i = 0; i < memberId.length; i++) {
    hash = (hash * 31 + memberId.charCodeAt(i)) % 9973;
  }
  return CONSEJOS[(dayOfYear + hash) % CONSEJOS.length];
}
