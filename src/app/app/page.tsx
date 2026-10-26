import { Suspense } from "react";
import { redirect } from "next/navigation";
import { auth } from "@/lib/auth/server";
import { loadDesk } from "./actions";
import { RemoteApp } from "./RemoteApp";

export default function DeskPage() {
  return (
    <Suspense fallback={<main className="lockwrap" id="main"><p className="c2">Loading your desk…</p></main>}>
      <Desk />
    </Suspense>
  );
}

async function Desk() {
  const { data: session } = await auth.getSession();
  if (!session?.user) redirect("/sign-in");
  const desk = await loadDesk();
  if (!desk) redirect("/dashboard");
  return <RemoteApp initial={desk.snapshot} member={desk.member} />;
}
