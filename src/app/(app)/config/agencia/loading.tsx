import { Skeleton } from "@/components/ui/misc";

export default function AgenciaLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-32" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>
      {/* ConfigNav: volver + 7 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="card space-y-4 p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="h-10 w-full" />
          <div className="grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="card flex items-center gap-4 p-5">
          <Skeleton className="size-20 rounded-2xl" />
          <Skeleton className="h-10 w-32 rounded-xl" />
        </div>
        <div className="card space-y-4 p-5">
          <Skeleton className="h-5 w-48" />
          <div className="flex gap-2.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="size-11 rounded-full" />
            ))}
          </div>
        </div>
        <div className="flex justify-end">
          <Skeleton className="h-12 w-full rounded-xl sm:w-44" />
        </div>
      </div>
    </>
  );
}
