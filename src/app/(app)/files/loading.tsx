import { Skeleton } from "@/components/ui/misc";

export default function LoadingFiles() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* PageHeader */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div className="space-y-2">
          <Skeleton className="h-8 w-28" />
          <Skeleton className="h-4 w-24" />
        </div>
        <Skeleton className="h-10 w-32 rounded-xl" />
      </div>

      <div className="space-y-3 px-4 pb-4 md:px-6">
        {/* stat tiles */}
        <div className="grid grid-cols-3 gap-2.5 md:grid-cols-4 md:gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={i === 3 ? "hidden md:block" : undefined}>
              <div className="card space-y-2 p-3.5 md:p-4">
                <Skeleton className="h-3 w-20" />
                <Skeleton className="h-6 w-16" />
              </div>
            </div>
          ))}
        </div>

        {/* búsqueda */}
        <Skeleton className="h-10 w-full rounded-xl" />

        {/* filtros */}
        <div className="flex items-center justify-between gap-2">
          <Skeleton className="h-9 w-72 rounded-full" />
          <Skeleton className="h-9 w-32 rounded-full" />
        </div>

        {/* filas */}
        <div className="card divide-y divide-line overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3.5">
              <Skeleton className="h-4 w-14" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-56" />
              </div>
              <Skeleton className="hidden h-4 w-20 md:block" />
              <Skeleton className="h-4 w-16" />
              <Skeleton className="size-8 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
