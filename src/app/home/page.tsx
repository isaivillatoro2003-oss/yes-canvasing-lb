"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { homeFor, useApp } from "@/lib/app-context";
import { PageLoader } from "@/components/ui";

/** Entry point for the installed app: routes each role to its home. */
export default function HomeRedirect() {
  const { ready, session, profile } = useApp();
  const router = useRouter();
  useEffect(() => {
    if (!ready) return;
    if (!session) router.replace("/");
    else if (profile) router.replace(profile.active ? homeFor(profile.role) : "/sign-in?inactive=1");
  }, [ready, session, profile, router]);
  return <PageLoader />;
}
