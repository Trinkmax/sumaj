import { redirect } from "next/navigation";

// Ruta legacy: los chats ahora viven como subsección del CRM.
export default function ChatsPage() {
  redirect("/crm?vista=chats");
}
