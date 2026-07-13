import { Skeleton } from "@/components/ui/misc";

export default function SeguimientoLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="mt-2 h-4 w-72" />
      </div>
      <div className="flex gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        {Array.from({ length: 6 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="size-9 rounded-full" />
            <div className="flex-1">
              <Skeleton className="h-5 w-44" />
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          </div>
          <div className="mt-5 flex items-center gap-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-10 w-16" />
            ))}
          </div>
        </div>
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="card p-5">
            <div className="flex items-center justify-between">
              <Skeleton className="h-5 w-52" />
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
            <div className="mt-4 flex flex-wrap items-end gap-6">
              <Skeleton className="h-10 w-[110px] rounded-xl" />
              <div className="flex gap-1.5">
                {Array.from({ length: 4 }).map((_, j) => (
                  <Skeleton key={j} className="h-7 w-24 rounded-full" />
                ))}
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
