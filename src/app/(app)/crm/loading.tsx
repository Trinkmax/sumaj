import { Skeleton } from "@/components/ui/misc";

export default function CrmLoading() {
  return (
    <div>
      {/* PageHeader */}
      <div className="flex items-end justify-between px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div>
          <Skeleton className="h-8 w-28" />
          <Skeleton className="mt-2 h-4 w-52" />
        </div>
        <Skeleton className="hidden h-10 w-32 rounded-xl md:block" />
      </div>

      {/* toolbar */}
      <div className="mb-3 flex flex-wrap items-center gap-2 px-4 md:px-6">
        <Skeleton className="h-9 w-52 rounded-full" />
        <Skeleton className="h-9 w-32 rounded-full" />
        <Skeleton className="h-9 min-w-[160px] flex-1 rounded-full sm:max-w-xs" />
      </div>

      {/* columnas del kanban */}
      <div className="flex gap-3 overflow-hidden px-4 md:px-6">
        {[4, 3, 2, 2, 1, 1].map((cards, i) => (
          <div
            key={i}
            className="flex w-[85vw] shrink-0 flex-col overflow-hidden rounded-2xl border border-line bg-sand-soft/50 md:w-[270px]"
          >
            <Skeleton className="h-1.5 w-full rounded-none" />
            <div className="flex items-center justify-between px-3 py-2.5">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-5 w-7 rounded-full" />
            </div>
            <div className="space-y-2 px-2 pb-2">
              {Array.from({ length: cards }).map((_, j) => (
                <div key={j} className="card space-y-2 p-3">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3.5 w-1/2" />
                  <div className="flex items-center justify-between pt-1">
                    <Skeleton className="h-5 w-20 rounded-full" />
                    <Skeleton className="size-5 rounded-full" />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
