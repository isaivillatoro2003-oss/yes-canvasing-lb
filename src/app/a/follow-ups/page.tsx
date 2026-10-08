"use client";

import { PageHeader } from "@/components/app/shell";
import { FollowUpList } from "@/components/app/follow-up-list";

export default function AdminFollowUps() {
  return (
    <>
      <PageHeader back="/a" title="Follow-ups" />
      <FollowUpList showOwner />
    </>
  );
}
