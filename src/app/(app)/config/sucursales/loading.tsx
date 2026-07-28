import { Skeleton } from "@/components/ui/misc";

export default function SucursalesLoading() {
  return (
    <>
      {/* PageHeader */}
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-40" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      {/* ConfigNav: volver + pills */}
      <div className="flex items-center gap-1.5 overflow-hidden px-4 py-2 md:px-6">
        <Skeleton className="size-8 shrink-0 rounded-full" />
        {Array.from({ length: 8 }).map((_, i) => (
          <Skeleton key={i} className="h-8 w-24 shrink-0 rounded-full" />
        ))}
      </div>

      <div className="mx-auto mt-4 max-w-3xl space-y-4 px-4 md:mx-0 md:px-6">
        <div className="flex items-start justify-between gap-3">
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-10 w-32 shrink-0 rounded-xl" />
        </div>

        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="card p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="mt-1 size-3 rounded-full" />
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <Skeleton className="h-5 w-36" />
                  <Skeleton className="h-5 w-24 rounded-full" />
                </div>
                <Skeleton className="mt-2 h-3.5 w-52" />
              </div>
              <Skeleton className="size-8 shrink-0 rounded-xl" />
            </div>

            {/* Vendedores */}
            <div className="mt-4 flex items-center gap-3">
              <Skeleton className="size-7 rounded-full" />
              <Skeleton className="h-4 w-28" />
            </div>

            {/* Canal de WhatsApp */}
            <div className="mt-4 rounded-2xl border border-line bg-sand-soft/50 p-4">
              <div className="flex items-start gap-3">
                <Skeleton className="mt-1.5 size-2.5 rounded-full" />
                <div className="flex-1">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="mt-2 h-3.5 w-full max-w-sm" />
                </div>
              </div>
              <div className="mt-4 flex gap-2">
                <Skeleton className="h-8 w-36 rounded-xl" />
                <Skeleton className="h-8 w-32 rounded-xl" />
              </div>
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
