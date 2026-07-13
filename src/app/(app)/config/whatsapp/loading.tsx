import { Skeleton } from "@/components/ui/misc";

export default function WhatsappLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {/* ConfigNav: volver + 7 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 7 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="mt-1.5 size-3 rounded-full" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-5 w-24 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-full" />
            </div>
          </div>
          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <Skeleton className="h-10 w-full rounded-xl" />
            <Skeleton className="h-10 w-full rounded-xl" />
          </div>
          <div className="mt-4 flex justify-end">
            <Skeleton className="h-10 w-24 rounded-xl" />
          </div>
        </div>
        <div className="card p-5">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="mt-2 h-4 w-64" />
          <Skeleton className="mt-4 h-11 w-full rounded-xl" />
          <div className="mt-5 space-y-3">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-center gap-3">
                <Skeleton className="size-6 rounded-full" />
                <Skeleton className="h-4 flex-1" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
