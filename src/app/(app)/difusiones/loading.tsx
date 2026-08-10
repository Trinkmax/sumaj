import { Skeleton } from "@/components/ui/misc";

export default function LoadingDifusiones() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* PageHeader */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div className="space-y-2">
          <Skeleton className="h-8 w-40" />
          <Skeleton className="h-4 w-56" />
        </div>
        <Skeleton className="h-10 w-36 rounded-xl" />
      </div>

      <div className="space-y-4 px-4 md:px-6">
        {/* acumulado */}
        <div className="grid grid-cols-3 gap-2.5 md:gap-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="card space-y-2 p-3.5 md:p-4">
              <Skeleton className="h-3 w-20" />
              <Skeleton className="h-6 w-12" />
            </div>
          ))}
        </div>

        {/* tarjetas de difusión */}
        <div className="space-y-2.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-4">
              <div className="flex items-center justify-between gap-2">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-3 w-28" />
              </div>
              <Skeleton className="mt-2 h-4 w-52" />
              <div className="mt-3 grid grid-cols-3 gap-2">
                {Array.from({ length: 3 }).map((_, j) => (
                  <div key={j} className="rounded-xl border border-line bg-sand-soft/50 px-2.5 py-2">
                    <Skeleton className="h-2.5 w-16" />
                    <Skeleton className="mt-1.5 h-5 w-8" />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
