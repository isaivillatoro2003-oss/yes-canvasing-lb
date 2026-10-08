import type { Reconciliation } from "@/lib/types";
import { Badge } from "@/components/ui";

export function ReconBadge({ status }: { status: Reconciliation["status"] | string }) {
  const map: Record<string, { tone: "default" | "success" | "warning" | "danger" | "info" | "navy"; label: string }> = {
    pending: { tone: "default", label: "Pending" },
    balanced: { tone: "success", label: "Balanced" },
    difference: { tone: "warning", label: "Difference" },
    approved: { tone: "navy", label: "Approved" },
    locked: { tone: "info", label: "Locked" },
  };
  const m = map[status] ?? map.pending;
  return <Badge tone={m.tone}>{m.label}</Badge>;
}
