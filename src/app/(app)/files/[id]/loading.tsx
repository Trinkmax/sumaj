import { Skeleton } from "@/components/ui/misc";

export default function LoadingFileDetail() {
  return (
    <div className="mx-auto w-full max-w-6xl">
      {/* back link */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-5 w-16" />
      </div>

      {/* header */}
      <div className="space-y-3 px-4 pb-1 pt-4 md:px-6">
        <div className="flex items-center gap-2">
          <Skeleton className="h-6 w-20 rounded-lg" />
          <Skeleton className="h-6 w-24 rounded-full" />
        </div>
        <Skeleton className="h-9 w-64" />
        <div className="flex flex-wrap items-center gap-3">
          <Skeleton className="h-5 w-36" />
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-5 w-44" />
        </div>
      </div>

      {/* cards */}
      <div className="flex flex-col gap-4 px-4 pb-4 pt-4 md:px-6 lg:grid lg:grid-cols-[3fr_2fr] lg:items-start">
        <div className="flex min-w-0 flex-col gap-4">
          {/* servicios */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-9 rounded-xl" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-3 w-32" />
                </div>
                <Skeleton className="h-4 w-16" />
                <Skeleton className="h-6 w-10 rounded-full" />
              </div>
            ))}
            <div className="border-t border-line pt-3">
              <Skeleton className="h-5 w-52" />
            </div>
          </div>

          {/* pasajeros */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-5 w-28" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-8 rounded-full" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-40" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="flex min-w-0 flex-col gap-4">
          {/* cobros */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-2.5 w-full rounded-full" />
            <Skeleton className="h-8 w-36" />
            <Skeleton className="h-11 w-full rounded-xl" />
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="flex items-center justify-between gap-3">
                <div className="space-y-2">
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
