// Guardia de build: en un archivo "use server" NO puede haber re-exports.
//
// Por qué existe: `export type { SentMessage }` en src/lib/actions/messages.ts
// compilaba con tsc y con next build, pero en producción Turbopack lo registró
// como una server action más (`registerServerReference(SentMessage, …)`) sobre
// un identificador que solo existe en tipos → ReferenceError al cargar el
// módulo → TODAS las actions de ese archivo devolvían 500 (el chat no mandaba
// nada, sin toast, sin fila). Solo se veía en los logs de Vercel.
//
// Un `export type X = …` declarado en el archivo se borra bien; la trampa es
// la forma re-export (`export type { X }` / `export { X } from`).
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const ROOT = new URL("../src/", import.meta.url).pathname;
const RE_EXPORT = /^\s*export\s+(type\s+)?\{[^}]*\}(\s+from\s+["'][^"']+["'])?\s*;?\s*$/m;

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(p);
  }
  return out;
}

const malos = [];
for (const file of walk(ROOT)) {
  const src = readFileSync(file, "utf8");
  if (!/^\s*["']use server["']/.test(src)) continue;
  const m = src.match(RE_EXPORT);
  if (m) malos.push(`${file.replace(ROOT, "src/")}: ${m[0].trim()}`);
}

if (malos.length) {
  console.error("\n✖ Re-export en un archivo \"use server\" (rompe el módulo entero en producción):\n");
  for (const l of malos) console.error("   " + l);
  console.error("\n  Importá el tipo desde su módulo de origen en vez de re-exportarlo acá.\n");
  process.exit(1);
}
console.log("✓ server actions: sin re-exports");
