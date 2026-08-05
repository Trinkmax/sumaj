import { Skeleton } from "@/components/ui/misc";

export default function WhatsappLoading() {
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

      <div className="mt-4 max-w-3xl space-y-4 px-4 md:px-6">
        {/* Cómo funciona: 3 pasos */}
        <div className="card p-5">
          <Skeleton className="h-5 w-40" />
          <Skeleton className="mt-2 h-4 w-56" />
          <div className="mt-4 space-y-3.5">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-48" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Cabecera de estado */}
        <div className="card p-5">
          <div className="flex items-start gap-3">
            <Skeleton className="mt-1.5 size-3 rounded-full" />
            <div className="flex-1">
              <div className="flex items-center gap-2">
                <Skeleton className="h-6 w-32" />
                <Skeleton className="h-5 w-32 rounded-full" />
              </div>
              <Skeleton className="mt-2 h-4 w-full" />
              <Skeleton className="mt-1.5 h-3 w-40" />
            </div>
          </div>
        </div>

        {/* Asistente: 3 pasos */}
        <div className="card overflow-hidden p-0">
          {/* paso 1: los cuatro datos de Meta */}
          <div className="p-5">
            <div className="flex items-start gap-3">
              <Skeleton className="size-7 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-4 w-40" />
                <Skeleton className="h-4 w-full" />
              </div>
            </div>
            <div className="mt-4 grid gap-4 sm:grid-cols-2 sm:pl-10">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className={i === 0 ? "sm:col-span-2" : undefined}>
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="mt-1.5 h-11 w-full rounded-xl" />
                  <Skeleton className="mt-1.5 h-3 w-4/5" />
                </div>
              ))}
            </div>
            <div className="mt-4 flex justify-end sm:pl-10">
              <Skeleton className="h-12 w-44 rounded-xl" />
            </div>
          </div>

          {/* pasos 2 y 3 */}
          {Array.from({ length: 2 }).map((_, i) => (
            <div key={i} className="border-t border-line p-5">
              <div className="flex items-start gap-3">
                <Skeleton className="size-7 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-44" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
              <div className="mt-4 sm:pl-10">
                <Skeleton className="h-[60px] w-full rounded-2xl" />
              </div>
            </div>
          ))}
        </div>

        {/* Diagnóstico */}
        <div className="card p-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex flex-1 items-start gap-3">
              <Skeleton className="size-9 shrink-0 rounded-full" />
              <div className="flex-1 space-y-1.5">
                <Skeleton className="h-5 w-32" />
                <Skeleton className="h-4 w-52" />
              </div>
            </div>
            <Skeleton className="h-10 w-32 shrink-0 rounded-xl" />
          </div>
          <div className="mt-5 space-y-4">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="mt-0.5 size-4.5 shrink-0 rounded-full" />
                <div className="flex-1 space-y-1.5">
                  <Skeleton className="h-4 w-32" />
                  <Skeleton className="h-4 w-full" />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
