import { Skeleton } from "@/components/ui/misc";

export default function InicioLoading() {
  return (
    <div className="mx-auto w-full max-w-5xl px-4 pb-6 md:px-6">
      {/* header */}
      <div className="pt-6 md:pt-8">
        <Skeleton className="h-8 w-56 md:h-9 md:w-72" />
        <Skeleton className="mt-2 h-4 w-40" />
      </div>

      <div className="mt-6 space-y-10 md:mt-8">
        {/* para hoy */}
        <div>
          <Skeleton className="h-3 w-20" />
          <div className="mt-3 grid grid-cols-3 gap-2 md:gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-2xl md:h-28" />
            ))}
          </div>
          <Skeleton className="mt-4 h-4 w-28" />
          <div className="card mt-2 divide-y divide-line overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-2/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
                <Skeleton className="h-3 w-14" />
              </div>
            ))}
          </div>
        </div>

        {/* el mes */}
        <div>
          <Skeleton className="h-3 w-16" />
          <div className="mt-3 grid grid-cols-2 gap-2 md:grid-cols-4 md:gap-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-[74px] rounded-2xl" />
            ))}
          </div>
          <div className="mt-3 grid gap-3 md:grid-cols-[minmax(0,1fr)_320px]">
            <Skeleton className="h-56 rounded-2xl md:h-60" />
            <Skeleton className="hidden h-60 rounded-2xl md:block" />
          </div>
        </div>

        {/* la pauta */}
        <div>
          <Skeleton className="h-3 w-20" />
          <Skeleton className="mt-2 h-3.5 w-52" />
          <div className="card mt-3 divide-y divide-line overflow-hidden">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3 px-4 py-3.5">
                <Skeleton className="h-4 flex-1" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-8" />
                <Skeleton className="h-4 w-10" />
                <Skeleton className="h-4 w-12" />
              </div>
            ))}
          </div>
        </div>

        {/* radar */}
        <div>
          <Skeleton className="h-3 w-14" />
          <div className="mt-3 grid gap-3 md:grid-cols-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-48 rounded-2xl" />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
