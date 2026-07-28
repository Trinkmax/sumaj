import { Skeleton } from "@/components/ui/misc";

export default function ProveedoresLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      {/* ConfigNav: volver + 8 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <div className="card overflow-hidden">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="flex items-center gap-3 border-b border-line px-5 py-3.5 last:border-0">
              <div className="flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-1.5 h-3 w-52" />
              </div>
              <Skeleton className="h-6 w-10 rounded-full" />
              <Skeleton className="size-8 rounded-xl" />
              <Skeleton className="size-8 rounded-xl" />
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
