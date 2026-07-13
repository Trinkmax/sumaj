import { Skeleton } from "@/components/ui/misc";

export default function PresupuestoDetalleLoading() {
  return (
    <>
      {/* header */}
      <div className="flex items-end justify-between gap-3 px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <div>
          <Skeleton className="h-8 w-56" />
          <Skeleton className="mt-2 h-4 w-64" />
        </div>
        <Skeleton className="h-6 w-20 rounded-full" />
      </div>

      <div className="grid items-start gap-6 px-4 md:px-6 lg:grid-cols-2 xl:grid-cols-[440px_minmax(0,1fr)]">
        {/* hoja del presupuesto */}
        <div>
          <Skeleton className="mx-auto mb-2 h-3 w-32" />
          <Skeleton className="mx-auto h-[560px] w-full max-w-[420px] rounded-[4px]" />
        </div>

        {/* panel interno */}
        <div className="space-y-4">
          <Skeleton className="h-12 w-full rounded-xl" />
          <div className="grid grid-cols-2 gap-2">
            <Skeleton className="h-10 rounded-xl" />
            <Skeleton className="h-10 rounded-xl" />
          </div>
          <Skeleton className="h-24 w-full rounded-2xl" />
          <Skeleton className="h-56 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
          <Skeleton className="h-40 w-full rounded-2xl" />
        </div>
      </div>
    </>
  );
}
