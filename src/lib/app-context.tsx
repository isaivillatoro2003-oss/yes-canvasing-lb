"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { isConfigured, rpc, sb } from "./supabase";
import type { Lang, Profile, Role, Settings } from "./types";
import { LANGS, translate, type TKey } from "./i18n";
import { cacheGet, cacheSet, startSyncLoop } from "./sync";

type Ctx = {
  ready: boolean;
  session: Session | null;
  profile: Profile | null;
  settings: Settings;
  lang: Lang;
  setLang: (l: Lang) => void;
  t: (k: TKey) => string;
  refreshProfile: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  signOut: () => Promise<void>;
  online: boolean;
  toast: (message: string, tone?: ToastTone) => void;
};

export type ToastTone = "default" | "success" | "error";

const DEFAULT_SETTINGS: Settings = {
  org_name: "YES — Youth Education Scholarship",
  logo_url: null,
  currency: "USD",
  timezone: "Asia/Beirut",
  default_language: "en",
  allow_multiple_sessions: false,
  collect_contacts: true,
  donations_enabled: true,
  payment_methods: ["cash", "whish", "other"],
  access_code_prefix: "YES",
  access_code_default_days: 30,
  campaign_start_date: null,
  data_controller: "YES — Youth Education Scholarship",
  privacy_contact: null,
  retention_years: 5,
};

const AppCtx = createContext<Ctx | null>(null);

export function useApp(): Ctx {
  const c = useContext(AppCtx);
  if (!c) throw new Error("useApp outside provider");
  return c;
}

export function homeFor(role: Role | undefined): string {
  return role === "admin" ? "/a" : role === "leader" ? "/l" : "/s";
}

type Toast = { id: number; message: string; tone: ToastTone };

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [ready, setReady] = useState(!isConfigured);
  const [session, setSession] = useState<Session | null>(null);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS);
  const [langOverride, setLangOverride] = useState<Lang | null>(null);
  const [online, setOnline] = useState(true);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const toastId = useRef(0);

  const toast = useCallback((message: string, tone: ToastTone = "default") => {
    const id = ++toastId.current;
    setToasts((t) => [...t.slice(-2), { id, message, tone }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), tone === "error" ? 5200 : 3200);
  }, []);

  const loadProfile = useCallback(async (uid: string | undefined) => {
    if (!uid) { setProfile(null); return; }
    const { data, error } = await sb().from("profiles").select("*").eq("id", uid).maybeSingle();
    if (data) {
      setProfile(data as Profile);
      cacheSet("profile", data);
    } else if (error) {
      // Offline: fall back to the last known profile so the app still opens in the field.
      const cached = await cacheGet<Profile>("profile");
      if (cached?.id === uid) setProfile(cached);
    } else {
      setProfile(null);
    }
  }, []);

  const refreshSettings = useCallback(async () => {
    const { data } = await sb().from("app_settings").select("*").eq("id", 1).maybeSingle();
    if (data) {
      setSettings({ ...DEFAULT_SETTINGS, ...(data as Settings) });
      cacheSet("settings", data);
    } else {
      const cached = await cacheGet<Settings>("settings");
      if (cached) setSettings({ ...DEFAULT_SETTINGS, ...cached });
    }
  }, []);

  useEffect(() => {
    if (!isConfigured) return;
    let mounted = true;
    const client = sb();
    (async () => {
      const { data } = await client.auth.getSession();
      if (!mounted) return;
      setSession(data.session);
      await Promise.all([loadProfile(data.session?.user.id), refreshSettings()]);
      if (mounted) setReady(true);
    })();
    const { data: sub } = client.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      // defer: never await Supabase calls inside this callback
      setTimeout(() => loadProfile(s?.user.id), 0);
    });
    startSyncLoop((n) => toast(`${n} saved transaction${n > 1 ? "s" : ""} synced`, "success"));
    return () => { mounted = false; sub.subscription.unsubscribe(); };
  }, [loadProfile, refreshSettings, toast]);

  // Connectivity
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update();
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  // Language: choice made now → profile preference → organisation default
  const lang: Lang = langOverride ?? profile?.preferred_language ?? settings.default_language ?? "en";

  useEffect(() => {
    const def = LANGS.find((l) => l.code === lang) ?? LANGS[0];
    document.documentElement.lang = def.code;
    document.documentElement.dir = def.dir;
  }, [lang]);

  const setLang = useCallback((l: Lang) => {
    setLangOverride(l);
    if (profile) rpc("update_my_profile", { p_full_name: profile.full_name, p_phone: profile.phone, p_language: l }).catch(() => {});
  }, [profile]);

  const signOut = useCallback(async () => {
    await sb().auth.signOut();
    setProfile(null);
    setSession(null);
  }, []);

  const value = useMemo<Ctx>(() => ({
    ready, session, profile, settings, lang, setLang,
    t: (k: TKey) => translate(lang, k),
    refreshProfile: () => loadProfile(session?.user.id),
    refreshSettings, signOut, online, toast,
  }), [ready, session, profile, settings, lang, setLang, loadProfile, refreshSettings, signOut, online, toast]);

  return (
    <AppCtx.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
           style={{ top: "calc(env(safe-area-inset-top, 0px) + 12px)" }} aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id}
               className={`enter pointer-events-auto max-w-sm rounded-2xl px-4 py-3 text-sm font-medium shadow-float ${
                 t.tone === "error" ? "bg-danger text-white" : t.tone === "success" ? "bg-success text-white" : "bg-primary text-primary-fg"}`}>
            {t.message}
          </div>
        ))}
      </div>
    </AppCtx.Provider>
  );
}

/**
 * Client-side route guard. This is only about UX (sending people to the right
 * screen) — the real permissions are enforced by the database.
 */
export function useRequireRole(roles: Role[]) {
  const { ready, session, profile } = useApp();
  const router = useRouter();
  const allowed = !!profile && profile.active && roles.includes(profile.role);
  useEffect(() => {
    if (!ready) return;
    if (!session) { router.replace("/sign-in"); return; }
    if (profile && !profile.active) { router.replace("/sign-in?inactive=1"); return; }
    if (profile && !roles.includes(profile.role)) router.replace(homeFor(profile.role));
  }, [ready, session, profile, roles, router]);
  return { allowed, profile };
}
