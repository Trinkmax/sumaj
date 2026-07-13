import { Skeleton } from "@/components/ui/misc";

export default function LoadingClientes() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* PageHeader */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div className="space-y-2">
          <Skeleton className="h-8 w-36" />
          <Skeleton className="h-4 w-48" />
        </div>
        <Skeleton className="h-9 w-36 rounded-xl" />
      </div>

      <div className="space-y-3 px-4 md:px-6">
        {/* búsqueda */}
        <Skeleton className="h-10 w-full rounded-xl" />
        {/* segmented + filtro */}
        <div className="flex items-center justify-between">
          <Skeleton className="h-9 w-60 rounded-full" />
          <Skeleton className="h-8 w-24 rounded-full" />
        </div>

        {/* filas de contactos */}
        <div className="card divide-y divide-line overflow-hidden">
          {Array.from({ length: 8 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-3.5 py-3">
              <Skeleton className="size-10 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="h-3 w-12" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
