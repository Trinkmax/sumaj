import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

/**
 * `src/contract.ts` del worker tiene que ser byte a byte igual a
 * `src/lib/wa/worker-contract.ts` de la app. No se puede importar (node_modules
 * separados, deploys separados), así que se compara el hash de los dos al
 * arrancar. Solo tiene sentido corriendo desde el repo (dev): en la imagen de
 * Docker no está ninguno de los dos fuentes y el chequeo se saltea callado.
 */
export async function warnIfContractDiverged(): Promise<void> {
  const here = dirname(fileURLToPath(import.meta.url)); // worker/src o worker/dist
  const mine = resolve(here, "../src/contract.ts");
  const theirs = resolve(here, "../../src/lib/wa/worker-contract.ts");
  try {
    const [a, b] = await Promise.all([readFile(mine), readFile(theirs)]);
    const ha = createHash("sha256").update(a).digest("hex");
    const hb = createHash("sha256").update(b).digest("hex");
    if (ha !== hb) {
      console.warn(
        "[contract] worker/src/contract.ts y src/lib/wa/worker-contract.ts DIVERGEN: la app y el worker no hablan el mismo contrato.",
      );
    }
  } catch {
    // fuera del repo (Docker) no hay nada que comparar
  }
}
