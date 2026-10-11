import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { AdminNav } from "./nav";
import { getViewer, isOfficer } from "@/lib/auth";

export const metadata = { title: "Admin" };

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const v = await getViewer();
  if (!v) redirect("/login?next=/admin");
  if (!isOfficer(v)) {
    return <section className="intro"><h1>Officers only</h1><p className="lede">Ask an admin to make you an officer.</p></section>;
  }
  return (
    <>
      <h1>Admin</h1>
      <AdminNav />
      {children}
    </>
  );
}
