/**
 * Audio de WhatsApp: del contenedor que graba el navegador al que acepta Meta.
 *
 * ─────────────────────────────────────────────
 * POR QUÉ EXISTE ESTE ARCHIVO
 *
 * `MediaRecorder` en Chrome (y en todo lo que es Chromium: Edge, Brave, el
 * WebView de Android) graba audio SOLO como `audio/webm;codecs=opus`. La Cloud
 * API de WhatsApp no acepta `audio/webm`: acepta `audio/ogg`, y con una letra
 * chica que arruina el día del que la descubre tarde — dice la doc de Meta,
 * textual: "OPUS codecs only; base audio/ogg not supported; mono input only".
 *
 * O sea: los dos lados quieren Opus. El códec ya coincide. Lo único distinto es
 * la CAJA donde vienen los paquetes: WebM (Matroska) de un lado, Ogg del otro.
 * Entonces no hay que decodificar ni volver a comprimir nada — hay que sacar los
 * paquetes de una caja y ponerlos en la otra. Eso es un REMUX, y por eso este
 * archivo no tiene dependencias: es leer bytes y escribir bytes.
 *
 * La alternativa era ffmpeg.wasm (25 MB al navegador del vendedor para no
 * transcodificar nada) o mandar el audio al servidor. Las dos son peores.
 *
 * ─────────────────────────────────────────────
 * DOS COSAS QUE ACÁ NO SE PUEDEN ARREGLAR
 *
 * 1. MONO. Meta rechaza el estéreo y remezclar exige decodificar, que es
 *    justamente lo que este archivo evita. El micrófono se pide en mono desde
 *    el caller (`getUserMedia({ audio: { channelCount: 1 } })`); si igual entra
 *    estéreo, el Ogg sale bien formado y el que se queja es Meta.
 * 2. LO QUE NO SEA OPUS. Un WebM con Vorbis o con AAC no se puede remuxear a
 *    Ogg/Opus. Eso devuelve null y el caller decide (avisar, o mandar el archivo
 *    como documento).
 *
 * ─────────────────────────────────────────────
 * FIRMA MENTAL DEL PARSEO
 *
 * WebM = EBML: todo es (id, tamaño, contenido) y los "master" anidan más de lo
 * mismo. Lo que buscamos son dos cosas: el TrackEntry con CodecID "A_OPUS" —de
 * ahí sale el CodecPrivate, que ES la cabecera OpusHead tal cual la quiere Ogg—
 * y los frames de audio adentro de los SimpleBlock de cada Cluster.
 *
 * Ojo con los tamaños desconocidos: `MediaRecorder` graba en vivo, no sabe
 * cuánto va a durar, y escribe el Segment y los Cluster con tamaño desconocido.
 * Un parser que asuma tamaños cerrados no lee nada de lo que graba Chrome.
 */

/** Preferencia de grabación. El primero que soporte el navegador, gana. */
const RECORDER_PREFERENCE = [
  // Firefox graba Ogg/Opus nativo: cero remux, cero riesgo. Va primero.
  "audio/ogg;codecs=opus",
  "audio/webm;codecs=opus",
  // Sin `codecs` Chrome igual usa Opus, pero recién lo sabemos al leer el WebM.
  "audio/webm",
];

/** ¿El navegador puede grabar algo que después podamos convertir? */
export function pickRecorderMimeType(): string | null {
  // Este módulo también se resuelve en el bundle del servidor: sin guarda, un
  // import desde un Server Component tira ReferenceError en build.
  if (typeof MediaRecorder === "undefined") return null;
  if (typeof MediaRecorder.isTypeSupported !== "function") return null;
  for (const mime of RECORDER_PREFERENCE) {
    if (MediaRecorder.isTypeSupported(mime)) return mime;
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// EBML (el contenedor WebM)

const ID_EBML_HEADER = 0x1a45dfa3;
const ID_SEGMENT = 0x18538067;
const ID_SEEK_HEAD = 0x114d9b74;
const ID_INFO = 0x1549a966;
const ID_TRACKS = 0x1654ae6b;
const ID_CHAPTERS = 0x1043a770;
const ID_CLUSTER = 0x1f43b675;
const ID_CUES = 0x1c53bb6b;
const ID_ATTACHMENTS = 0x1941a469;
const ID_TAGS = 0x1254c367;

const ID_TRACK_ENTRY = 0xae;
const ID_TRACK_NUMBER = 0xd7;
const ID_CODEC_ID = 0x86;
const ID_CODEC_PRIVATE = 0x63a2;

const ID_BLOCK_GROUP = 0xa0;
const ID_BLOCK = 0xa1;
const ID_SIMPLE_BLOCK = 0xa3;

/**
 * Elementos de nivel 1 (hijos directos del Segment). Sirven de freno: un Cluster
 * de tamaño desconocido termina exactamente donde arranca el que sigue, y sin
 * esta lista el parser se lo comería y anidaría un Cluster adentro del otro.
 */
const LEVEL1_IDS = new Set<number>([
  ID_EBML_HEADER,
  ID_SEGMENT,
  ID_SEEK_HEAD,
  ID_INFO,
  ID_TRACKS,
  ID_CHAPTERS,
  ID_CLUSTER,
  ID_CUES,
  ID_ATTACHMENTS,
  ID_TAGS,
]);

const CODEC_OPUS = "A_OPUS";

/** Un frame de audio: un rango de bytes dentro del WebM original. */
type Frame = { track: number; start: number; end: number };

type Scan = {
  bytes: Uint8Array;
  /** TrackNumber del track Opus (null si el archivo no trae ninguno). */
  opusTrack: number | null;
  /** CodecPrivate del track Opus = la cabecera OpusHead, lista para copiar. */
  opusHead: Uint8Array | null;
  frames: Frame[];
};

type Vint = { value: number; len: number; unknown: boolean };

/** Id de elemento: VINT que CONSERVA los bits de marca (a diferencia del tamaño). */
function readId(b: Uint8Array, pos: number, to: number): { id: number; len: number } | null {
  if (pos >= to) return null;
  const first = b[pos];
  let len: number;
  if (first & 0x80) len = 1;
  else if (first & 0x40) len = 2;
  else if (first & 0x20) len = 3;
  else if (first & 0x10) len = 4;
  else return null;
  if (pos + len > to) return null;
  // Multiplicar en vez de shiftear: un id de 4 bytes (0x1A45DFA3) no entra en
  // un int32 con signo y `<<` lo devolvería negativo.
  let id = 0;
  for (let i = 0; i < len; i++) id = id * 256 + b[pos + i];
  return { id, len };
}

/** VINT de tamaño: se le sacan los bits de marca. Todo en uno = tamaño desconocido. */
function readVint(b: Uint8Array, pos: number, to: number): Vint | null {
  if (pos >= to) return null;
  const first = b[pos];
  if (first === 0) return null; // más de 8 bytes de largo: no existe en la práctica
  let len = 1;
  let mask = 0x80;
  while ((first & mask) === 0) {
    len++;
    mask >>= 1;
  }
  if (pos + len > to) return null;
  let value = first & (mask - 1);
  let unknown = value === mask - 1;
  for (let i = 1; i < len; i++) {
    const byte = b[pos + i];
    if (byte !== 0xff) unknown = false;
    value = value * 256 + byte;
  }
  if (!unknown && !Number.isSafeInteger(value)) return null;
  return { value, len, unknown };
}

/** VINT con signo (solo lo usa el lacing EBML): el valor menos su sesgo. */
function readSignedVint(b: Uint8Array, pos: number, to: number): { value: number; len: number } | null {
  const raw = readVint(b, pos, to);
  if (!raw || raw.unknown) return null;
  return { value: raw.value - (Math.pow(2, 7 * raw.len - 1) - 1), len: raw.len };
}

function readUint(b: Uint8Array, from: number, to: number): number | null {
  if (to <= from || to - from > 8) return null;
  let value = 0;
  for (let i = from; i < to; i++) value = value * 256 + b[i];
  return Number.isSafeInteger(value) ? value : null;
}

function readAscii(b: Uint8Array, from: number, to: number): string {
  let out = "";
  for (let i = from; i < to; i++) {
    if (b[i] === 0) break; // los muxers rellenan el string con ceros
    out += String.fromCharCode(b[i]);
  }
  return out.trim();
}

function startsWithAscii(b: Uint8Array, text: string): boolean {
  if (b.length < text.length) return false;
  for (let i = 0; i < text.length; i++) {
    if (b[i] !== text.charCodeAt(i)) return false;
  }
  return true;
}

/**
 * Recorre los elementos de [from, to) y va llenando `scan`.
 *
 * Devuelve la posición donde frenó, o -1 si el archivo no cierra. `stopAtLevel1`
 * lo prende el Cluster de tamaño desconocido para saber dónde termina.
 */
function walk(scan: Scan, from: number, to: number, stopAtLevel1: boolean): number {
  let pos = from;
  while (pos < to) {
    const id = readId(scan.bytes, pos, to);
    if (!id) return -1;
    if (stopAtLevel1 && LEVEL1_IDS.has(id.id)) return pos;

    const size = readVint(scan.bytes, pos + id.len, to);
    if (!size) return -1;
    const contentStart = pos + id.len + size.len;

    if (size.unknown) {
      // Solo el Segment y los Cluster de una grabación en vivo vienen así. Un
      // elemento cualquiera con tamaño desconocido no se puede saltear: no hay
      // forma de saber dónde termina.
      if (id.id !== ID_SEGMENT && id.id !== ID_CLUSTER) return -1;
      const stopped = walk(scan, contentStart, to, id.id === ID_CLUSTER);
      if (stopped < 0) return -1;
      pos = stopped;
      continue;
    }

    const contentEnd = contentStart + size.value;
    if (contentEnd > to) return -1; // el tamaño se pasa del padre: archivo cortado

    switch (id.id) {
      case ID_SEGMENT:
      case ID_TRACKS:
      case ID_CLUSTER:
      case ID_BLOCK_GROUP:
        if (walk(scan, contentStart, contentEnd, false) < 0) return -1;
        break;
      case ID_TRACK_ENTRY:
        if (!readTrackEntry(scan, contentStart, contentEnd)) return -1;
        break;
      case ID_SIMPLE_BLOCK:
      case ID_BLOCK:
        if (!readBlock(scan, contentStart, contentEnd)) return -1;
        break;
      default:
        break; // todo lo demás se saltea entero
    }
    pos = contentEnd;
  }
  return pos;
}

/** Un TrackEntry: nos quedamos con el primero que declare Opus. */
function readTrackEntry(scan: Scan, from: number, to: number): boolean {
  let pos = from;
  let track: number | null = null;
  let codec = "";
  let codecPrivate: Uint8Array | null = null;

  while (pos < to) {
    const id = readId(scan.bytes, pos, to);
    if (!id) return false;
    const size = readVint(scan.bytes, pos + id.len, to);
    if (!size || size.unknown) return false;
    const start = pos + id.len + size.len;
    const end = start + size.value;
    if (end > to) return false;

    if (id.id === ID_TRACK_NUMBER) track = readUint(scan.bytes, start, end);
    else if (id.id === ID_CODEC_ID) codec = readAscii(scan.bytes, start, end);
    else if (id.id === ID_CODEC_PRIVATE) codecPrivate = scan.bytes.subarray(start, end);

    pos = end;
  }

  if (track !== null && codec === CODEC_OPUS && scan.opusTrack === null) {
    scan.opusTrack = track;
    scan.opusHead = codecPrivate;
  }
  return true;
}

/**
 * Un SimpleBlock (o un Block adentro de un BlockGroup): número de track (VINT),
 * timecode (int16), flags (1 byte) y después los frames.
 *
 * El lacing —varios frames en un mismo bloque— está implementado en las cuatro
 * variantes. Chrome no lo usa (un frame por bloque), pero descartar un bloque
 * lacado dejaría un hueco mudo en el audio sin que nadie se entere; y devolver
 * un Ogg con huecos es peor que no devolver nada. Si el lacing no cierra exacto,
 * esto falla y `webmOpusToOgg` termina en null.
 */
function readBlock(scan: Scan, from: number, to: number): boolean {
  const b = scan.bytes;
  const track = readVint(b, from, to);
  if (!track || track.unknown) return false;

  let pos = from + track.len;
  if (pos + 3 > to) return false; // timecode (2) + flags (1)
  const flags = b[pos + 2];
  pos += 3;

  const lacing = (flags >> 1) & 0x03;
  if (lacing === 0) {
    if (pos >= to) return false;
    scan.frames.push({ track: track.value, start: pos, end: to });
    return true;
  }

  if (pos >= to) return false;
  const count = b[pos] + 1;
  pos += 1;
  const sizes: number[] = [];

  if (lacing === 2) {
    // Fijo: todos los frames miden lo mismo y la división tiene que dar exacta.
    const total = to - pos;
    if (total <= 0 || total % count !== 0) return false;
    const each = total / count;
    for (let i = 0; i < count; i++) sizes.push(each);
  } else if (lacing === 1) {
    // Xiph: cada tamaño es una suma de bytes que corta en el primero < 255.
    for (let i = 0; i < count - 1; i++) {
      let size = 0;
      for (;;) {
        if (pos >= to) return false;
        const byte = b[pos++];
        size += byte;
        if (byte !== 0xff) break;
      }
      sizes.push(size);
    }
  } else {
    // EBML: el primero es un VINT y los que siguen son diferencias con signo.
    const first = readVint(b, pos, to);
    if (!first || first.unknown) return false;
    pos += first.len;
    sizes.push(first.value);
    for (let i = 1; i < count - 1; i++) {
      const delta = readSignedVint(b, pos, to);
      if (!delta) return false;
      pos += delta.len;
      const size = sizes[i - 1] + delta.value;
      if (size <= 0) return false;
      sizes.push(size);
    }
  }

  if (lacing !== 2) {
    // El último frame nunca lleva tamaño: ocupa lo que sobra del bloque.
    let used = 0;
    for (const size of sizes) used += size;
    const last = to - pos - used;
    if (last <= 0) return false;
    sizes.push(last);
  }
  if (sizes.length !== count) return false;

  for (const size of sizes) {
    if (size <= 0 || pos + size > to) return false;
    scan.frames.push({ track: track.value, start: pos, end: pos + size });
    pos += size;
  }
  // Si sobran bytes, los tamaños que leímos no eran los de este bloque.
  return pos === to;
}

// ─────────────────────────────────────────────────────────────────────────────
// Opus: cuánto dura un paquete

/**
 * Muestras a 48 kHz por frame, indexado por el `config` del TOC (5 bits altos
 * del primer byte del paquete). 0–11 SILK (10/20/40/60 ms), 12–15 híbrido
 * (10/20 ms), 16–31 CELT (2,5/5/10/20 ms).
 */
const OPUS_FRAME_SAMPLES = [
  480, 960, 1920, 2880, // SILK NB
  480, 960, 1920, 2880, // SILK MB
  480, 960, 1920, 2880, // SILK WB
  480, 960, // híbrido SWB
  480, 960, // híbrido FB
  120, 240, 480, 960, // CELT NB
  120, 240, 480, 960, // CELT WB
  120, 240, 480, 960, // CELT SWB
  120, 240, 480, 960, // CELT FB
];

/** Un paquete Opus no puede pasar de 120 ms. Si da más, leímos cualquier cosa. */
const MAX_PACKET_SAMPLES = 5760;

/**
 * Duración de un paquete en muestras de 48 kHz, sacada del byte TOC: los 5 bits
 * altos dicen el modo (y con él, cuánto dura un frame) y los 2 bajos ("c")
 * cuántos frames trae el paquete.
 *
 * Hace falta para la granule position del Ogg, que es lo que le dice al
 * reproductor cuánto dura el audio. Sin esto, el mensaje llega con duración
 * cero y WhatsApp lo muestra como una nota de voz rota.
 */
function packetSamples(packet: Uint8Array): number | null {
  if (packet.length < 1) return null;
  const toc = packet[0];
  const perFrame = OPUS_FRAME_SAMPLES[toc >> 3];
  const code = toc & 0x03;

  let frames: number;
  if (code === 0) frames = 1;
  else if (code === 1 || code === 2) frames = 2;
  else {
    // Código 3: la cantidad viene en el segundo byte (6 bits bajos).
    if (packet.length < 2) return null;
    frames = packet[1] & 0x3f;
  }
  if (frames < 1) return null;

  const samples = perFrame * frames;
  return samples > MAX_PACKET_SAMPLES ? null : samples;
}

// ─────────────────────────────────────────────────────────────────────────────
// Ogg (el contenedor que quiere Meta)

const OGG_HEADER_BYTES = 27;
const OGG_MAX_SEGMENTS = 255;
const HEADER_TYPE_BOS = 0x02;
const HEADER_TYPE_EOS = 0x04;

/** Un segundo de audio por página: lo que hace cualquier muxer de Ogg. */
const MAX_PAGE_SAMPLES = 48000;

const OPUS_TAGS_VENDOR = "viajerOS";

/**
 * CRC32 de Ogg: polinomio 0x04c11db7, SIN reflejar, init 0 y sin xor final. NO
 * es el CRC32 de zlib —ese refleja entrada y salida y arranca en 0xffffffff— y
 * confundirlos da un archivo que parece perfecto y que ningún decoder acepta.
 */
const OGG_CRC_TABLE = buildOggCrcTable();

function buildOggCrcTable(): Uint32Array {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let bit = 0; bit < 8; bit++) {
      r = (r & 0x80000000) !== 0 ? (r << 1) ^ 0x04c11db7 : r << 1;
    }
    table[i] = r >>> 0;
  }
  return table;
}

function oggCrc(page: Uint8Array): number {
  let crc = 0;
  for (let i = 0; i < page.length; i++) {
    crc = (((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ page[i]) & 0xff]) >>> 0);
  }
  return crc;
}

/**
 * Una página de Ogg con los paquetes que le entren.
 *
 * La tabla de segmentos parte cada paquete en tramos de 255 bytes y cierra con
 * uno más corto; si el largo es múltiplo exacto de 255 hay que escribir un
 * segmento de 0 igual, porque es lo único que marca el fin del paquete.
 */
function makePage(
  serial: number,
  seq: number,
  headerType: number,
  granule: number,
  packets: Uint8Array[],
): Uint8Array | null {
  const table: number[] = [];
  let dataLen = 0;
  for (const packet of packets) {
    let rest = packet.length;
    while (rest >= 255) {
      table.push(255);
      rest -= 255;
    }
    table.push(rest);
    dataLen += packet.length;
  }
  if (table.length === 0 || table.length > OGG_MAX_SEGMENTS) return null;

  const page = new Uint8Array(OGG_HEADER_BYTES + table.length + dataLen);
  const view = new DataView(page.buffer);
  page[0] = 0x4f; // "O"
  page[1] = 0x67; // "g"
  page[2] = 0x67; // "g"
  page[3] = 0x53; // "S"
  page[4] = 0; // versión
  page[5] = headerType;
  // La granule position es de 64 bits y se escribe en dos mitades: JS no tiene
  // enteros de 64 bits y BigInt acá no aporta nada.
  view.setUint32(6, granule % 4294967296, true);
  view.setUint32(10, Math.floor(granule / 4294967296), true);
  view.setUint32(14, serial, true);
  view.setUint32(18, seq, true);
  // 22..25 = CRC: queda en cero mientras se calcula, que es como se define.
  page[26] = table.length;
  page.set(table, OGG_HEADER_BYTES);

  let offset = OGG_HEADER_BYTES + table.length;
  for (const packet of packets) {
    page.set(packet, offset);
    offset += packet.length;
  }
  view.setUint32(22, oggCrc(page), true);
  return page;
}

/** OpusTags: obligatorio como segundo paquete del stream, aunque vaya vacío. */
function opusTagsPacket(): Uint8Array {
  const vendor = new TextEncoder().encode(OPUS_TAGS_VENDOR);
  const packet = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(packet.buffer);
  for (let i = 0; i < 8; i++) packet[i] = "OpusTags".charCodeAt(i);
  view.setUint32(8, vendor.length, true);
  packet.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true); // cero comentarios de usuario
  return packet;
}

// Sin tipo de retorno explícito a propósito: así TypeScript infiere que el
// Uint8Array es dueño de su ArrayBuffer, que es lo que `Blob` exige.
function concat(chunks: Uint8Array[]) {
  let total = 0;
  for (const chunk of chunks) total += chunk.length;
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

/**
 * Arma el stream: página con OpusHead (BOS), página con OpusTags y después las
 * de audio, la última con el flag de fin de stream.
 */
function buildOgg(opusHead: Uint8Array, packets: Uint8Array[], durations: number[]) {
  // El serial solo tiene que distinguir streams multiplexados y acá hay uno.
  const serial = Math.floor(Math.random() * 0x100000000) >>> 0;
  const pages: Uint8Array[] = [];

  const headPage = makePage(serial, 0, HEADER_TYPE_BOS, 0, [opusHead]);
  const tagsPage = makePage(serial, 1, 0, 0, [opusTagsPacket()]);
  if (!headPage || !tagsPage) return null;
  pages.push(headPage, tagsPage);

  let seq = 2;
  let granule = 0;
  let batch: Uint8Array[] = [];
  let batchSegments = 0;
  let batchSamples = 0;

  for (let i = 0; i < packets.length; i++) {
    const packet = packets[i];
    const segments = Math.floor(packet.length / 255) + 1;
    // Un paquete de más de 65 KB no existe en Opus; si aparece, algo leímos mal.
    if (segments > OGG_MAX_SEGMENTS) return null;

    const full = batchSegments + segments > OGG_MAX_SEGMENTS || batchSamples >= MAX_PAGE_SAMPLES;
    if (batch.length > 0 && full) {
      const page = makePage(serial, seq++, 0, granule, batch);
      if (!page) return null;
      pages.push(page);
      batch = [];
      batchSegments = 0;
      batchSamples = 0;
    }

    batch.push(packet);
    batchSegments += segments;
    // La granule position acumula muestras a 48 kHz e incluye el pre-skip que ya
    // declara el OpusHead: es el total que va a soltar el decoder, no el audible.
    // No se recorta el relleno del último paquete (Ogg lo permite bajando la
    // granule de la página final): son 10 o 20 ms al final de una nota de voz y
    // el dato para calcularlo no está en el WebM que graba el navegador.
    granule += durations[i];
    batchSamples += durations[i];
  }

  const lastPage = makePage(serial, seq, HEADER_TYPE_EOS, granule, batch);
  if (!lastPage) return null;
  pages.push(lastPage);

  return concat(pages);
}

// El mime va sin el parámetro `codecs`: Meta compara el string contra su lista
// de tipos aceptados y "audio/ogg; codecs=opus" no está en esa lista.
const OGG_MIME = "audio/ogg";

/**
 * Remuxea un WebM con audio Opus a Ogg/Opus. Devuelve null si el WebM no
 * trae Opus o si el contenedor no se pudo leer: el caller decide qué hacer.
 */
export function webmOpusToOgg(webm: ArrayBuffer): Blob | null {
  try {
    const bytes = new Uint8Array(webm);
    if (bytes.length === 0) return null;

    const scan: Scan = { bytes, opusTrack: null, opusHead: null, frames: [] };
    if (walk(scan, 0, bytes.length, false) < 0) return null;

    const { opusTrack, opusHead } = scan;
    if (opusTrack === null || !opusHead) return null;
    // El CodecPrivate de un track A_OPUS ES el OpusHead (19 bytes mínimo). Si no
    // lo es, copiarlo al Ogg daría un archivo sintácticamente válido y mudo.
    if (opusHead.length < 19 || !startsWithAscii(opusHead, "OpusHead")) return null;

    const packets: Uint8Array[] = [];
    const durations: number[] = [];
    for (const frame of scan.frames) {
      if (frame.track !== opusTrack) continue;
      const packet = bytes.subarray(frame.start, frame.end);
      const samples = packetSamples(packet);
      // Un paquete que no se puede medir rompe la granule position de toda la
      // página; mejor cortar acá que mandar un audio con la duración mentida.
      if (samples === null) return null;
      packets.push(packet);
      durations.push(samples);
    }
    if (packets.length === 0) return null;

    const ogg = buildOgg(opusHead, packets, durations);
    if (!ogg) return null;
    return new Blob([ogg], { type: OGG_MIME });
  } catch {
    // Cualquier índice fuera de rango termina en null y no en una excepción que
    // el vendedor vería como "algo salió mal" arriba de un audio ya grabado.
    return null;
  }
}
