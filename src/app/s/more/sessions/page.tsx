"use client";

import { useApp } from "@/lib/app-context";
import { useData } from "@/lib/hooks";
import { sb, toAppError } from "@/lib/supabase";
import type { WorkSession } from "@/lib/types";
import { PageLoader } from "@/components/ui";
import { SessionList } from "@/components/app/session-list";
import { PageHeader } from "@/components/app/shell";

export default function MySessions() {
  const { profile, settings } = useApp();
  const uid = profile!.id;
  const sessions = useData(`sessions:${uid}`, async () => {
    const { data, error } = await sb().from("work_sessions").select("*").eq("user_id", uid).order("started_at", { ascending: false }).limit(60);
    if (error) throw toAppError(error);
    return data as WorkSession[];
  }, [uid]);
  return (
    <>
      <PageHeader back title="Work sessions" />
      <div className="px-5">{!sessions.data ? <PageLoader /> : <SessionList sessions={sessions.data} tz={settings.timezone} />}</div>
    </>
  );
}
