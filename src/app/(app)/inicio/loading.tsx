import { Skeleton } from "@/components/ui/misc";

export default function InicioLoading() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 pb-6 md:px-6">
      {/* header: fecha + saludo + consejo */}
      <div className="pt-5 md:pt-6">
        <Skeleton className="h-3 w-36" />
        <Skeleton className="mt-2 h-8 w-52 md:h-9 md:w-64" />
        <Skeleton className="mt-3 h-4 w-72 max-w-full" />
      </div>

      {/* banda de KPIs */}
      <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4 md:mt-5 md:gap-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-[74px] rounded-2xl" />
        ))}
      </div>

      {/* para hoy + card con tabs */}
      <div className="mt-4 grid gap-4 md:mt-5 lg:grid-cols-12 lg:gap-5">
        <div className="lg:col-span-5">
          <Skeleton className="h-4 w-20" />
          <div className="mt-2 grid grid-cols-3 gap-2 md:gap-3">
            {Array.from({ length: 3 }).map((_, i) => (
              <Skeleton key={i} className="h-[104px] rounded-2xl" />
            ))}
          </div>
          <div className="card mt-3 overflow-hidden md:mt-4">
            <div className="border-b border-line px-3.5 py-2">
              <Skeleton className="h-3.5 w-24" />
            </div>
            <div className="divide-y divide-line">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex items-center gap-3 px-3.5 py-2.5">
                  <div className="min-w-0 flex-1 space-y-1.5">
                    <Skeleton className="h-3.5 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                  <Skeleton className="h-3 w-12" />
                </div>
              ))}
            </div>
          </div>
        </div>

        <div className="lg:col-span-7">
          <div className="card flex h-full flex-col p-4">
            <div className="flex items-center justify-between gap-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-8 w-44 rounded-full" />
            </div>
            <Skeleton className="mt-3 h-40 w-full flex-1 rounded-xl md:h-44" />
          </div>
        </div>
      </div>

      {/* radar */}
      <div className="mt-4 grid gap-2 sm:grid-cols-2 md:mt-5 md:gap-3 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-44 rounded-2xl" />
        ))}
      </div>
    </div>
  );
}
