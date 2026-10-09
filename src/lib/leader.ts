"use client";

import { rpc, sb, toAppError } from "./supabase";
import type { Profile } from "./types";

export type ActiveSession = {
  session_id: string; user_id: string; full_name: string; team_name: string | null;
  started_at: string; last_heartbeat: string | null; presentations: number;
  status: "active" | "paused"; paused_at: string | null; start_place: string | null;
  last_seen_at: string | null; last_place: string | null; last_lat: number | null; last_lng: number | null;
  location_status: string | null;
};

export type SessionEvent = {
  id: string; session_id: string; user_id: string; event_type: string; occurred_at: string;
  latitude: number | null; longitude: number | null; accuracy_m: number | null;
  city: string | null; neighborhood: string | null; location_status: string; transaction_id: string | null;
};

export type PendingDay = { student_id: string; full_name: string; work_date: string; status: string; transactions: number; expected: number };

export const getActiveSessions = () => rpc<ActiveSession[]>("active_sessions");
export const getPendingDays = (limit = 100) => rpc<PendingDay[]>("pending_days", { p_limit: limit });

/** Students the caller can see (RLS limits leaders to their own team). */
export async function getMyStudents(excludeId?: string): Promise<(Profile & { teams: { team_name: string } | null })[]> {
  let q = sb().from("profiles").select("*, teams!profiles_team_fk(team_name)").eq("role", "student").order("full_name");
  if (excludeId) q = q.neq("id", excludeId);
  const { data, error } = await q;
  if (error) throw toAppError(error);
  return data as (Profile & { teams: { team_name: string } | null })[];
}
