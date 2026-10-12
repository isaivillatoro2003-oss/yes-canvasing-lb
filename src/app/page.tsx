"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { GraduationCap, HandHeart, Sparkles, Users } from "lucide-react";
import { homeFor, useApp } from "@/lib/app-context";
import { isConfigured } from "@/lib/supabase";
import { LinkButton } from "@/components/ui";
import { Logo } from "@/components/app/shell";
import { SetupNotice } from "@/components/app/setup-notice";

export default function Welcome() {
  const { ready, session, profile, t } = useApp();
  const router = useRouter();

  useEffect(() => {
    if (ready && session && profile?.active) router.replace(homeFor(profile.role));
  }, [ready, session, profile, router]);

  if (!isConfigured) return <SetupNotice />;

  return (
    <main className="hero app-height safe-top safe-bottom relative flex flex-col overflow-hidden text-white">
      {/* soft light from the top, like paper catching the sun */}
      <div aria-hidden className="pointer-events-none absolute -top-40 left-1/2 h-[28rem] w-[40rem] -translate-x-1/2 rounded-full bg-[radial-gradient(closest-side,rgba(91,141,239,0.28),transparent)]" />
      <div className="relative mx-auto flex w-full max-w-md flex-1 flex-col px-6">
        <div className="enter flex flex-1 flex-col justify-center pt-16">
          <Logo size={72} className="shadow-float rounded-[18px] ring-1 ring-white/10" />
          <h1 className="text-display mt-8">{t("welcome.title")}</h1>
          <p className="mt-3 text-lg text-[var(--cream-200)]/80">{t("welcome.subtitle")}</p>
          <ul className="mt-10 space-y-4 text-[15px] text-[var(--cream-200)]/90">
            {[
              [GraduationCap, "Education that opens doors"],
              [HandHeart, "Service in every neighborhood"],
              [Users, "One team, every day"],
              [Sparkles, "Every book is an opportunity"],
            ].map(([Icon, label], i) => {
              const I = Icon as typeof GraduationCap;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="glass-dark grid size-9 place-items-center rounded-[12px]"><I className="size-[18px] text-[var(--steel-300)]" /></span>
                  {label as string}
                </li>
              );
            })}
          </ul>
        </div>
        <div className="enter space-y-3 pb-8 pt-10" style={{ animationDelay: "80ms" }}>
          <LinkButton href="/sign-in" size="lg" block className="!bg-white !text-[var(--navy-900)] !shadow-float">{t("auth.signIn")}</LinkButton>
          <LinkButton href="/sign-up" size="lg" block variant="ghost" className="glass-dark !text-white">{t("auth.createAccount")}</LinkButton>
          <p className="pt-2 text-center text-xs text-[var(--cream-200)]/50">You need an access code from your YES leader to create an account. · <a href="/privacy" className="underline">Privacy</a></p>
          <a href="/demo" className="pressable block pt-1 text-center text-sm font-semibold text-[var(--steel-300)]">Have a demo code? Try the demo →</a>
        </div>
      </div>
    </main>
  );
}
