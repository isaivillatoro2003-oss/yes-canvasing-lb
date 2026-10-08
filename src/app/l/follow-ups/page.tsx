"use client";

import { PageHeader } from "@/components/app/shell";
import { FollowUpList } from "@/components/app/follow-up-list";

export default function TeamFollowUps() {
  return (
    <>
      <PageHeader back title="Team follow-ups" />
      <div className="px-5"><FollowUpList showOwner /></div>
    </>
  );
}
