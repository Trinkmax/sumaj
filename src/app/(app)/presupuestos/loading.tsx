import { Skeleton } from "@/components/ui/misc";

export default function PresupuestosLoading() {
  return (
    <>
      {/* header */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div>
          <Skeleton className="h-8 w-48" />
          <Skeleton className="mt-2 h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-44 rounded-xl" />
      </div>

      <div className="px-4 md:px-6">
        {/* búsqueda + segmented */}
        <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <Skeleton className="h-10 w-full rounded-xl sm:max-w-xs" />
          <Skeleton className="h-9 w-72 rounded-full" />
        </div>

        {/* filas */}
        <div className="card divide-y divide-line overflow-hidden">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 px-4 py-3 sm:px-5">
              <div className="min-w-0 flex-1">
                <Skeleton className="h-4 w-2/3 max-w-64" />
                <Skeleton className="mt-2 h-3 w-1/2 max-w-48" />
              </div>
              <div className="flex flex-col items-end gap-2">
                <Skeleton className="h-4 w-20" />
                <Skeleton className="hidden h-3 w-12 sm:block" />
              </div>
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
