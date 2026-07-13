import { Skeleton } from "@/components/ui/misc";

export default function EtiquetasLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-60" />
      </div>
      {/* ConfigNav: volver + 7 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-56" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-5">
            <Skeleton className="h-3 w-20" />
            <div className="mt-3 flex flex-wrap gap-2">
              {Array.from({ length: 4 }).map((_, j) => (
                <Skeleton key={j} className="h-7 w-24 rounded-full" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
