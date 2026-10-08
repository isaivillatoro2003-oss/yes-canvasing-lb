export type Role = "student" | "leader" | "admin";

export type Profile = {
  id: string;
  full_name: string;
  email: string;
  phone: string | null;
  role: Role;
  team_id: string | null;
  leader_id: string | null;
  active: boolean;
  preferred_language: Lang | null;
  created_at: string;
  last_login: string | null;
};

export type Lang = "en" | "fr" | "ar";

export type Settings = {
  org_name: string;
  logo_url: string | null;
  currency: string;
  timezone: string;
  default_language: Lang;
  allow_multiple_sessions: boolean;
  collect_contacts: boolean;
  donations_enabled: boolean;
  payment_methods: string[];
  access_code_prefix: string;
  access_code_default_days: number;
  campaign_start_date: string | null;
};

export type Book = {
  id: string;
  code: string;
  name: string | null;
  category: string | null;
  unit_value: number | null;
  language: string | null;
  image_url: string | null;
  active: boolean;
  warehouse_qty: number;
  sort_order: number;
};

export type InventoryRow = {
  user_id: string;
  book_id: string;
  assigned: number;
  distributed: number;
  returned: number;
  adjusted: number;
  remaining: number;
  books?: Book;
};

export type WorkSession = {
  id: string;
  user_id: string;
  work_date: string;
  started_at: string;
  last_heartbeat: string | null;
  ended_at: string | null;
  status: "active" | "completed" | "auto_closed";
  duration_minutes: number | null;
  presentations: number;
  notes: string | null;
};

export type Team = { id: string; team_name: string; leader_id: string | null; active: boolean; notes: string | null; created_at: string };

export type Territory = {
  id: string; territory_name: string; city: string | null; area: string | null; territory_type: string;
  active: boolean; latitude: number | null; longitude: number | null; notes: string | null;
};

export type Transaction = {
  id: string; session_id: string | null; user_id: string; transaction_datetime: string; work_date: string;
  territory_id: string | null; city: string | null; neighborhood: string | null; book_value_total: number;
  donation_amount: number; expected_total: number; total_paid: number; payment_difference: number;
  status: "draft" | "completed" | "cancelled"; customer_id: string | null; notes: string | null;
  cancelled_reason: string | null;
};

export type TxSummary = {
  id: string; status: string; books: number; book_value: number; donation: number; expected: number;
  received: number; difference: number; remaining_inventory: number; duplicate?: boolean;
};

export type ReportSummary = {
  from: string; to: string; work_minutes: number; active_minutes: number; presentations: number; working_now: number;
  students_active: number; books_distributed: number; book_value: number; donations: number;
  expected: number; received: number; transactions: number;
  by_book: { code: string; name: string | null; quantity: number; value: number }[];
  by_method: Record<string, number>;
  by_user: {
    id: string; full_name: string; minutes: number; presentations: number; working: boolean; books: number;
    book_value: number; donations: number; received: number; transactions: number;
  }[];
};

export type Reconciliation = {
  id: string; student_id: string; leader_id: string | null; work_date: string; expected_book_value: number;
  expected_donations: number; expected_total: number; recorded_received: number; cash_submitted: number;
  whish_submitted: number; other_submitted: number; total_submitted: number; money_difference: number;
  books_expected: number; books_returned: number; books_counted: number | null; book_difference: number;
  status: "pending" | "balanced" | "difference" | "approved" | "locked"; override_used: boolean;
  approved_by: string | null; approved_at: string | null; notes: string | null;
};

export type DaySummary = {
  student: { id: string; full_name: string; email: string };
  date: string;
  has_active_session: boolean;
  active_session_id: string | null;
  work_minutes: number;
  presentations: number;
  books: { assigned: number; distributed: number; returned: number; remaining: number };
  inventory: { book_id: string; code: string; name: string | null; remaining: number }[];
  finance: { book_value: number; donations: number; expected: number };
  payments: { cash: number; whish: number; other: number; total: number };
  transactions: number;
  reconciliation: Reconciliation | null;
};

export type Customer = {
  id: string; created_by: string; name: string | null; phone: string | null; whatsapp: string | null;
  email: string | null; city: string | null; neighborhood: string | null; notes: string | null;
  consent: boolean; consent_date: string | null; created_at: string;
};

export type FollowUp = {
  id: string; customer_id: string; created_date: string; follow_up_type: string; assigned_to: string;
  due_date: string | null; status: "new" | "contacted" | "follow_up_again" | "completed" | "closed";
  last_contact_date: string | null; outcome: string | null; notes: string | null;
};

export type AccessCode = {
  id: string; code: string; role: "student" | "leader"; team_id: string | null; created_by: string | null;
  created_at: string; expires_at: string | null; max_uses: number; current_uses: number; active: boolean;
  used_by: string | null; used_at: string | null; notes: string | null;
};
