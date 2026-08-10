import { Skeleton } from "@/components/ui/misc";

/**
 * Sin este archivo la boundary más cercana era la de la lista: al tocar "Nueva
 * difusión" aparecía medio segundo el esqueleto de una lista de difusiones —la
 * pantalla de la que uno acaba de salir— y de golpe mutaba en un formulario.
 * Parecía que la navegación había fallado y había vuelto.
 */
export default function LoadingNuevaDifusion() {
  return (
    <div className="mx-auto w-full max-w-3xl">
      {/* volver + PageHeader */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-5 w-28" />
      </div>
      <div className="space-y-2 px-4 pb-4 pt-3 md:px-6">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-4 w-64" />
      </div>

      <div className="space-y-4 px-4 md:px-6">
        {/* 1 · a quiénes */}
        <div className="card space-y-4 p-4 sm:p-5">
          <PasoTitulo />
          <div className="grid grid-cols-2 gap-2">
            {Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-16 rounded-xl" />
            ))}
          </div>
          <Skeleton className="h-11 w-full rounded-xl" />
          <div className="rounded-2xl border border-brand-tint-line bg-brand-tint p-4">
            <Skeleton className="h-10 w-32" />
            <div className="mt-3 flex flex-wrap gap-1.5">
              {Array.from({ length: 5 }).map((_, i) => (
                <Skeleton key={i} className="h-7 w-28 rounded-full" />
              ))}
            </div>
          </div>
        </div>

        {/* 2 · qué les decís */}
        <div className="card space-y-3 p-4 sm:p-5">
          <PasoTitulo />
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-xl" />
          ))}
        </div>

        {/* 3 · cuándo */}
        <div className="card space-y-4 p-4 sm:p-5">
          <PasoTitulo />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
          <Skeleton className="h-10 w-full rounded-xl" />
        </div>

        {/* barra de disparo */}
        <div className="card flex items-center gap-3 p-3">
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="h-3 w-28" />
          </div>
          <Skeleton className="h-12 w-28 rounded-xl" />
        </div>
      </div>
    </div>
  );
}

function PasoTitulo() {
  return (
    <div className="flex items-start gap-2.5">
      <Skeleton className="size-6 rounded-full" />
      <div className="space-y-1.5">
        <Skeleton className="h-5 w-40" />
        <Skeleton className="h-3 w-56" />
      </div>
    </div>
  );
}
