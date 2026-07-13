import { Skeleton } from "@/components/ui/misc";

export default function LoadingClienteDetalle() {
  return (
    <div className="mx-auto w-full max-w-5xl">
      {/* back link */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-5 w-20" />
      </div>

      {/* header: avatar + nombre + chips + info */}
      <div className="px-4 pt-3 md:px-6">
        <div className="flex items-start gap-4">
          <Skeleton className="size-16 rounded-full md:size-20" />
          <div className="flex-1 space-y-2.5">
            <Skeleton className="h-7 w-52" />
            <div className="flex gap-1.5">
              <Skeleton className="h-5 w-16 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
            </div>
            <Skeleton className="h-4 w-64" />
          </div>
        </div>
        {/* navegación cruzada: chips + acciones rápidas */}
        <div className="mt-4 flex flex-wrap gap-2">
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-9 w-28 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
          <Skeleton className="h-9 w-20 rounded-full" />
          <Skeleton className="h-8 w-36 rounded-xl" />
          <Skeleton className="h-8 w-40 rounded-xl" />
        </div>
      </div>

      {/* cards */}
      <div className="grid gap-4 px-4 pt-4 md:px-6 lg:grid-cols-[2fr_3fr] lg:items-start">
        <div className="space-y-4">
          {/* Grupo de viaje */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-6 w-36" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-3 w-40" />
                </div>
                <Skeleton className="h-8 w-20 rounded-full" />
              </div>
            ))}
            {/* fila de alta inline */}
            <div className="flex items-center gap-2 border-t border-line pt-3">
              <Skeleton className="size-9 rounded-full" />
              <Skeleton className="h-9 flex-1 rounded-xl" />
              <Skeleton className="h-9 w-24 rounded-xl" />
            </div>
          </div>
          {/* Datos */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-6 w-20" />
            <Skeleton className="h-4 w-full" />
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-4 w-2/3" />
          </div>
        </div>

        <div className="space-y-4">
          {/* Historia */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-6 w-24" />
            <div className="grid grid-cols-3 gap-2">
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
              <Skeleton className="h-14 rounded-xl" />
            </div>
            <Skeleton className="h-9 w-64 rounded-full" />
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-12 w-full rounded-xl" />
            ))}
          </div>
          {/* Actividad */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-6 w-24" />
            <Skeleton className="h-16 w-full rounded-xl" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-32" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
