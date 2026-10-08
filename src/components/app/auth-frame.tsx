"use client";

import Link from "next/link";
import { ChevronLeft } from "lucide-react";
import { Logo } from "./shell";

export function AuthFrame({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: React.ReactNode; footer?: React.ReactNode }) {
  return (
    <main className="app-height safe-top safe-bottom bg-bg">
      <div className="mx-auto flex max-w-md flex-col px-6 pb-10">
        <div className="flex h-12 items-center">
          <Link href="/" className="pressable -ms-2 inline-flex items-center gap-0.5 rounded-xl px-2 py-1 text-[15px] font-medium text-muted">
            <ChevronLeft className="size-5 rtl:rotate-180" /> Back
          </Link>
        </div>
        <div className="enter pt-4">
          <Logo size={52} />
          <h1 className="text-title mt-6">{title}</h1>
          {subtitle && <p className="mt-2 text-muted">{subtitle}</p>}
          <div className="mt-8">{children}</div>
          {footer && <div className="mt-8 text-center text-sm text-muted">{footer}</div>}
        </div>
      </div>
    </main>
  );
}
