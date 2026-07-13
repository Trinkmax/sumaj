import { Skeleton } from "@/components/ui/misc";

export default function CajaLoading() {
  return (
    <div>
      {/* PageHeader */}
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-28 md:h-9" />
        <Skeleton className="mt-2 h-4 w-56" />
      </div>

      <div className="flex flex-col gap-4 px-4 md:px-6">
        {/* filtro de período: ‹ [Segmented] › */}
        <div className="flex items-center justify-center gap-1">
          <Skeleton className="size-11 rounded-full" />
          <Skeleton className="h-9 w-56 rounded-full" />
          <Skeleton className="size-11 rounded-full" />
        </div>

        {/* 3 números grandes con círculo tonal */}
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className={
                i === 0
                  ? "card col-span-2 flex items-center gap-3.5 p-4 md:col-span-1"
                  : "card flex items-center gap-3.5 p-4"
              }
            >
              <Skeleton className="size-11 shrink-0 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-3 w-28" />
                <Skeleton className="mt-2 h-7 w-32" />
              </div>
            </div>
          ))}
        </div>

        {/* tabs + acciones */}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <Skeleton className="h-9 w-72 rounded-full" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-36 rounded-xl" />
            <Skeleton className="h-8 w-36 rounded-xl" />
          </div>
        </div>

        {/* lista de movimientos */}
        <div className="card divide-y divide-line">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex min-h-16 items-center gap-3 px-3.5 py-2.5">
              <Skeleton className="size-9 rounded-full" />
              <div className="flex-1">
                <Skeleton className="h-4 w-36" />
                <Skeleton className="mt-1.5 h-3 w-48" />
              </div>
              <Skeleton className="h-4 w-20" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
