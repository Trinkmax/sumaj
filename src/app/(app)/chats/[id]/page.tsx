import { redirect } from "next/navigation";

// Ruta legacy: los chats ahora viven como subsección del CRM.
export default async function ChatPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  redirect(`/crm?vista=chats&c=${id}`);
}
