import { Skeleton } from "@/components/ui/misc";

export default function EquipoLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-28" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {/* ConfigNav: volver + 8 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between border-b border-line px-5 py-4">
            <div>
              <Skeleton className="h-5 w-24" />
              <Skeleton className="mt-2 h-3.5 w-48" />
            </div>
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-32" />
                <Skeleton className="mt-1.5 h-3 w-44" />
              </div>
              <Skeleton className="h-9 w-[104px] rounded-full" />
              <Skeleton className="h-9 w-[72px] rounded-xl" />
              <Skeleton className="h-6 w-10 rounded-full" />
            </div>
          ))}
        </div>
        <div className="card space-y-3 p-5">
          <Skeleton className="h-5 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-12 w-full" />
        </div>
      </div>
    </>
  );
}
