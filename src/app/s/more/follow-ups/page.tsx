"use client";

import { PageHeader } from "@/components/app/shell";
import { FollowUpList } from "@/components/app/follow-up-list";

export default function FollowUps() {
  return (
    <>
      <PageHeader back title="Follow-ups" />
      <div className="px-5"><FollowUpList /></div>
    </>
  );
}
