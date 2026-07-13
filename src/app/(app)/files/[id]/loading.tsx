import { Skeleton } from "@/components/ui/misc";

export default function LoadingFileDetail() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* back link */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-5 w-16" />
      </div>

      {/* header del expediente */}
      <div className="px-4 pt-4 md:px-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-2">
            <div className="flex items-center gap-2">
              <Skeleton className="h-6 w-20 rounded-lg" />
              <Skeleton className="h-6 w-24 rounded-full" />
            </div>
            <Skeleton className="h-9 w-64" />
            <div className="flex flex-wrap items-center gap-3">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="h-5 w-28" />
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            <Skeleton className="h-10 w-48 rounded-xl" />
            <Skeleton className="size-9 rounded-xl" />
          </div>
        </div>

        {/* stepper */}
        <div className="mt-5 flex w-full max-w-lg items-start">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className={i > 0 ? "flex min-w-0 flex-1 items-start" : "flex items-start"}>
              {i > 0 && <Skeleton className="mx-1 mt-[17px] h-0.5 min-w-3 flex-1 md:mx-1.5" />}
              <div className="flex min-w-11 shrink-0 flex-col items-center gap-1.5">
                <Skeleton className="size-9 rounded-full" />
                <Skeleton className="h-3 w-12" />
              </div>
            </div>
          ))}
        </div>

        {/* chips de navegación */}
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Skeleton className="h-10 w-36 rounded-full" />
          <Skeleton className="h-10 w-24 rounded-full" />
          <Skeleton className="h-10 w-32 rounded-full" />
        </div>
      </div>

      {/* cards */}
      <div className="flex flex-col gap-4 px-4 pb-4 pt-4 md:px-6 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* servicios agrupados */}
          <div className="card space-y-4 p-4 md:p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-28" />
              <Skeleton className="h-8 w-24 rounded-xl" />
            </div>
            {Array.from({ length: 2 }).map((_, g) => (
              <div key={g} className="space-y-2.5">
                <div className="flex items-center gap-2.5">
                  <Skeleton className="size-8 rounded-full" />
                  <Skeleton className="h-4 w-24" />
                  <Skeleton className="ml-auto h-3 w-16" />
                </div>
                <div className="space-y-2 pl-[42px]">
                  <div className="flex items-center gap-3">
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-4 w-48" />
                      <Skeleton className="h-3 w-32" />
                    </div>
                    <div className="space-y-1.5 text-right">
                      <Skeleton className="ml-auto h-4 w-20" />
                      <Skeleton className="ml-auto h-3 w-16" />
                    </div>
                    <Skeleton className="h-6 w-10 rounded-full" />
                  </div>
                </div>
              </div>
            ))}
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>

          {/* pasajeros */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* cobros con anillo de progreso */}
          <div className="card space-y-3.5 p-4 md:p-5">
            <Skeleton className="h-5 w-24" />
            <div className="flex items-center gap-4">
              <Skeleton className="size-16 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-6 w-28" />
                <Skeleton className="h-3.5 w-36" />
                <Skeleton className="h-4 w-24" />
              </div>
            </div>
            <Skeleton className="h-12 w-full rounded-xl" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-28" />
                  <Skeleton className="h-3 w-20" />
                </div>
                <Skeleton className="h-4 w-20" />
              </div>
            ))}
          </div>

          {/* notas */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-5 w-16" />
            <Skeleton className="h-24 w-full rounded-xl" />
          </div>
        </div>
      </div>
    </div>
  );
}
