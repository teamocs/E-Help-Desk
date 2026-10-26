"use client";

import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth/client";
import { pinSignOut } from "@/app/app/staff";

export function SignOut() {
  const router = useRouter();
  return (
    <button
      type="button"
      className="btn btn-gray btn-block"
      onClick={async () => {
        await pinSignOut(); // the acting-staff cookie must not outlive the device account's session
        await authClient.signOut();
        router.push("/sign-in");
        router.refresh();
      }}
    >
      Sign out
    </button>
  );
}
