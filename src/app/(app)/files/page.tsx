import { requireMember } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/shell/page-header";
import { FilesList } from "@/components/files/files-list";
import { NewFileButton } from "@/components/files/new-file-dialog";
import type { FileListRow } from "@/components/files/types";

export const metadata = { title: "Files" };

export default async function FilesPage() {
  const { member, isAdmin } = await requireMember();
  const supabase = await createClient();

  const [filesRes, totalsRes, contactsRes, membersRes] = await Promise.all([
    supabase
      .from("files")
      .select(
        "id, code, destination, status, review_status, currency, departure_date, return_date, created_at, seller_id, contact_id, contact:contacts(id, full_name), seller:members!files_seller_id_fkey(id, display_name)",
      )
      .order("created_at", { ascending: false }),
    supabase.from("file_totals").select("file_id, total_cost, total_sale, utility, paid_total, balance"),
    supabase.from("contacts").select("id, full_name, phone").order("full_name"),
    supabase
      .from("members")
      .select("id, display_name")
      .eq("is_active", true)
      .order("display_name"),
  ]);

  const totalsByFile = new Map(
    (totalsRes.data ?? []).map((t) => [
      t.file_id as string,
      {
        total_sale: Number(t.total_sale) || 0,
        utility: Number(t.utility) || 0,
        paid_total: Number(t.paid_total) || 0,
        balance: Number(t.balance) || 0,
      },
    ]),
  );

  const rows: FileListRow[] = (filesRes.data ?? []).map((f) => {
    const t = totalsByFile.get(f.id);
    return {
      id: f.id,
      code: f.code,
      destination: f.destination,
      status: f.status,
      review_status: f.review_status,
      currency: f.currency,
      departure_date: f.departure_date,
      return_date: f.return_date,
      created_at: f.created_at,
      seller_id: f.seller_id,
      contact_id: f.contact_id,
      contact_name: f.contact?.full_name ?? "—",
      seller_name: f.seller?.display_name ?? null,
      total_sale: t?.total_sale ?? 0,
      utility: t?.utility ?? 0,
      paid_total: t?.paid_total ?? 0,
      balance: t?.balance ?? 0,
    };
  });

  // las ventas que nacen del pipeline entran en revisión hasta que un admin las valida
  const pendingReview = rows.filter((r) => r.review_status === "pendiente").length;
  const subtitle =
    `${rows.length} ${rows.length === 1 ? "venta" : "ventas"}` +
    (isAdmin && pendingReview > 0
      ? ` · ${pendingReview} ${pendingReview === 1 ? "espera" : "esperan"} revisión`
      : "");

  return (
    <div className="mx-auto w-full max-w-6xl">
      <PageHeader
        title="Files"
        subtitle={subtitle}
        actions={
          <NewFileButton
            contacts={contactsRes.data ?? []}
            members={membersRes.data ?? []}
            myMemberId={member.id}
          />
        }
      />

      <div className="px-4 pb-4 md:px-6">
        <FilesList rows={rows} memberId={member.id} isAdmin={isAdmin} />
      </div>
    </div>
  );
}
