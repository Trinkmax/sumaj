import { Skeleton } from "@/components/ui/misc";

export default function LoadingDifusion() {
  return (
    <div className="mx-auto w-full max-w-4xl">
      {/* volver */}
      <div className="px-4 pt-4 md:px-6 md:pt-6">
        <Skeleton className="h-5 w-24" />
      </div>

      {/* PageHeader */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-3 md:px-6 md:pt-4">
        <div className="space-y-2">
          <Skeleton className="h-8 w-56" />
          <Skeleton className="h-4 w-64" />
        </div>
      </div>

      <div className="space-y-5 px-4 pb-4 md:px-6">
        <div className="space-y-4">
          {/* interesados / leads */}
          <div className="grid grid-cols-2 gap-2.5 md:gap-3">
            {Array.from({ length: 2 }).map((_, i) => (
              <div key={i} className="card space-y-2 p-4 md:p-5">
                <Skeleton className="h-3 w-24" />
                <Skeleton className="h-9 w-20" />
                <Skeleton className="h-2.5 w-28" />
              </div>
            ))}
          </div>

          {/* embudo */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-4 w-40" />
            {Array.from({ length: 7 }).map((_, i) => (
              <div key={i} className="flex items-center gap-2">
                <Skeleton className="size-1.5 rounded-full" />
                <Skeleton className="h-3 w-[86px] shrink-0 md:w-24" />
                <Skeleton className="h-1.5 flex-1 rounded-full" />
                <Skeleton className="h-3 w-9 shrink-0" />
              </div>
            ))}
          </div>

          {/* chips secundarios */}
          <div className="flex flex-wrap gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <Skeleton key={i} className="h-8 w-32 rounded-full" />
            ))}
          </div>

          {/* lo que recibieron */}
          <div className="card space-y-3 p-4 md:p-5">
            <Skeleton className="h-4 w-36" />
            <div className="rounded-xl bg-sand-soft/60 p-3 pl-8">
              <Skeleton className="ml-auto h-24 w-4/5 rounded-lg rounded-tr-none" />
            </div>
          </div>
        </div>

        {/* quiénes respondieron */}
        <div className="space-y-3">
          <Skeleton className="h-6 w-52" />
          <Skeleton className="h-8 w-40 rounded-full" />
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-3 p-3">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-3 w-52" />
              </div>
              <Skeleton className="h-3 w-14" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
