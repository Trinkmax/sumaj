import { Skeleton } from "@/components/ui/misc";

export default function LeadLoading() {
  return (
    <div className="mx-auto max-w-5xl px-4 pt-4 md:px-6 md:pt-6">
      {/* breadcrumb */}
      <Skeleton className="h-4 w-20" />

      {/* header: avatar grande + nombre + chips */}
      <div className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3.5">
          <Skeleton className="size-12 rounded-full md:size-14" />
          <div>
            <Skeleton className="h-8 w-56 md:h-9 md:w-72" />
            <Skeleton className="mt-2 h-4 w-64" />
            <div className="mt-2.5 flex gap-1.5">
              <Skeleton className="h-5 w-24 rounded-full" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-16 rounded-full" />
            </div>
          </div>
        </div>
        <Skeleton className="h-9 w-full rounded-xl sm:w-48" />
      </div>

      {/* stepper de etapas */}
      <div className="mt-4 grid grid-cols-4 gap-1.5">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="rounded-xl px-1 py-2">
            <Skeleton className="mb-1.5 h-1 w-full rounded-full" />
            <Skeleton className="mx-auto h-3.5 w-16" />
          </div>
        ))}
      </div>

      {/* acciones grandes */}
      <div className="mt-4 grid grid-cols-2 gap-2 md:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-12 rounded-xl" />
        ))}
      </div>

      {/* contenido */}
      <div className="mt-4 grid gap-4 pb-4 md:grid-cols-5">
        <div className="space-y-4 md:col-span-3">
          {[150, 160, 90, 110].map((h, i) => (
            <div key={i} className="card space-y-3 p-4">
              <div className="flex items-center gap-2">
                <Skeleton className="size-7 rounded-full" />
                <Skeleton className="h-5 w-36" />
              </div>
              <div className="skeleton w-full" style={{ height: h }} />
            </div>
          ))}
        </div>
        <div className="md:col-span-2">
          <div className="card space-y-3 p-4">
            <Skeleton className="h-5 w-24" />
            <Skeleton className="h-10 w-full rounded-xl" />
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-full" />
                  <Skeleton className="h-3 w-28" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
