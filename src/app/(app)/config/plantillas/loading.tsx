import { Skeleton } from "@/components/ui/misc";

export default function PlantillasLoading() {
  return (
    <>
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-36" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>
      {/* ConfigNav: volver + 8 pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>
      <div className="mt-4 max-w-4xl space-y-4 px-4 md:px-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-36 rounded-xl" />
        </div>
        <div className="grid gap-3 md:grid-cols-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="card p-5">
              <div className="flex gap-1.5">
                <Skeleton className="h-5 w-24 rounded-full" />
                <Skeleton className="h-5 w-28 rounded-full" />
              </div>
              <Skeleton className="mt-3 h-4 w-40" />
              {/* burbuja de WhatsApp */}
              <div className="mt-3 rounded-xl bg-sand-soft/60 p-3 pl-8">
                <Skeleton className="ml-auto h-16 w-4/5 rounded-lg rounded-tr-none" />
              </div>
              <div className="mt-3 flex items-center justify-between">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="h-6 w-10 rounded-full" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
