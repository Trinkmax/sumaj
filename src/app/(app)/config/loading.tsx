import { Skeleton } from "@/components/ui/misc";

export default function ConfigLoading() {
  return (
    <>
      {/* PageHeader */}
      <div className="px-4 pb-4 pt-5 md:px-6 md:pt-7">
        <Skeleton className="h-8 w-44" />
        <Skeleton className="mt-2 h-4 w-64" />
      </div>

      <div className="space-y-5 px-4 md:px-6">
        {/* Perfil */}
        <div className="card flex items-center gap-4 p-5">
          <Skeleton className="size-14 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-2 h-4 w-52" />
          </div>
          <Skeleton className="h-5 w-20 rounded-full" />
        </div>

        {/* Cards de secciones */}
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="card flex items-center gap-4 p-4">
              <Skeleton className="size-11 rounded-xl" />
              <div className="flex-1">
                <Skeleton className="h-4 w-24" />
                <Skeleton className="mt-2 h-3 w-40" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
