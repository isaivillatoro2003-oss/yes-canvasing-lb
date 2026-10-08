-- YES Canvassing App — schema
-- Every identifier is a UUID. Money is numeric(12,2). Business rules that must
-- never be bypassed live in CHECK constraints here and in the RPCs (0002).


-- ───────────────────────── Settings ─────────────────────────
create table public.app_settings (
  id                        int primary key default 1 check (id = 1),
  org_name                  text not null default 'YES — Youth Education Scholarship',
  logo_url                  text,
  currency                  text not null default 'USD',
  timezone                  text not null default 'Asia/Beirut',
  default_language          text not null default 'en' check (default_language in ('en','fr','ar')),
  allow_multiple_sessions   boolean not null default false,
  collect_contacts          boolean not null default true,
  donations_enabled         boolean not null default true,
  payment_methods           text[] not null default array['cash','whish','other'],
  access_code_prefix        text not null default 'YES',
  access_code_default_days  int not null default 30 check (access_code_default_days > 0),
  campaign_start_date       date,
  updated_at                timestamptz not null default now()
);
insert into public.app_settings default values;

-- ───────────────────────── People ─────────────────────────
create table public.profiles (
  id                 uuid primary key references auth.users(id) on delete restrict,
  full_name          text not null,
  email              text not null,
  phone              text,
  role               text not null default 'student' check (role in ('student','leader','admin')),
  team_id            uuid,
  leader_id          uuid references public.profiles(id),
  active             boolean not null default true,
  preferred_language text check (preferred_language in ('en','fr','ar')),
  created_at         timestamptz not null default now(),
  last_login         timestamptz
);

create table public.teams (
  id          uuid primary key default gen_random_uuid(),
  team_name   text not null,
  leader_id   uuid references public.profiles(id),
  active      boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now()
);
alter table public.profiles
  add constraint profiles_team_fk foreign key (team_id) references public.teams(id) on delete set null;

create table public.access_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code = upper(code) and length(code) between 4 and 40),
  role          text not null default 'student' check (role in ('student','leader')),
  team_id       uuid references public.teams(id) on delete set null,
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  max_uses      int not null default 1 check (max_uses >= 1),
  current_uses  int not null default 0 check (current_uses >= 0),
  active        boolean not null default true,
  used_by       uuid references public.profiles(id),
  used_at       timestamptz,
  notes         text
);

create table public.access_code_redemptions (
  id              uuid primary key default gen_random_uuid(),
  access_code_id  uuid not null references public.access_codes(id),
  user_id         uuid not null references public.profiles(id),
  used_at         timestamptz not null default now()
);

-- ───────────────────────── Work ─────────────────────────
create table public.work_sessions (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.profiles(id),
  work_date         date not null,
  started_at        timestamptz not null default now(),
  last_heartbeat    timestamptz,
  ended_at          timestamptz,
  status            text not null default 'active' check (status in ('active','completed','auto_closed')),
  duration_minutes  int check (duration_minutes >= 0),
  presentations     int not null default 0 check (presentations >= 0),
  notes             text,
  created_at        timestamptz not null default now(),
  check ((status = 'active') = (ended_at is null))
);
create index on public.work_sessions (user_id, work_date);
create index on public.work_sessions (status) where status = 'active';

-- ───────────────────────── Catalog & inventory ─────────────────────────
create table public.books (
  id             uuid primary key default gen_random_uuid(),
  code           text not null unique check (code = upper(code)),
  name           text,                       -- may stay empty until Admin confirms it
  category       text,
  unit_value     numeric(10,2) check (unit_value >= 0),  -- null = price not set yet; cannot be sold
  language       text,
  image_url      text,
  active         boolean not null default true,
  warehouse_qty  int not null default 0 check (warehouse_qty >= 0),
  sort_order     int not null default 0,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

-- One row per (student, book). Remaining is derived and can never go negative.
create table public.inventory (
  user_id      uuid not null references public.profiles(id),
  book_id      uuid not null references public.books(id),
  assigned     int not null default 0 check (assigned >= 0),
  distributed  int not null default 0 check (distributed >= 0),
  returned     int not null default 0 check (returned >= 0),
  adjusted     int not null default 0,
  remaining    int generated always as (assigned - distributed - returned + adjusted) stored,
  updated_at   timestamptz not null default now(),
  primary key (user_id, book_id),
  constraint inventory_never_negative check (assigned - distributed - returned + adjusted >= 0)
);

create table public.inventory_movements (
  id                      uuid primary key default gen_random_uuid(),
  user_id                 uuid references public.profiles(id),     -- null = warehouse movement
  book_id                 uuid not null references public.books(id),
  movement_type           text not null check (movement_type in
                            ('ASSIGN','SALE','RETURN','ADJUSTMENT','TRANSFER_IN','TRANSFER_OUT','WAREHOUSE_IN','CANCEL_SALE')),
  quantity                int not null check (quantity <> 0),
  related_transaction_id  uuid,
  performed_by            uuid references public.profiles(id),
  created_at              timestamptz not null default now(),
  notes                   text
);
create index on public.inventory_movements (user_id, created_at);

create table public.territories (
  id              uuid primary key default gen_random_uuid(),
  territory_name  text not null,
  city            text,
  area            text,
  territory_type  text not null default 'Residential' check (territory_type in
                    ('Residential','Business','Festival/Event','Institution','Church Outreach','Other')),
  active          boolean not null default true,
  latitude        numeric(9,6),
  longitude       numeric(9,6),
  notes           text,
  created_at      timestamptz not null default now()
);

-- ───────────────────────── Customers ─────────────────────────
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  created_by    uuid not null references public.profiles(id),
  name          text,
  phone         text,
  whatsapp      text,
  email         text,
  city          text,
  neighborhood  text,
  notes         text,
  consent       boolean not null default false,
  consent_date  timestamptz,
  created_at    timestamptz not null default now(),
  -- contact details are only stored when the person gave permission
  constraint customers_contact_needs_consent
    check (consent or (phone is null and whatsapp is null and email is null))
);

-- ───────────────────────── Money ─────────────────────────
create table public.transactions (
  id                    uuid primary key default gen_random_uuid(),  -- client-generated: idempotency key
  session_id            uuid references public.work_sessions(id),
  user_id               uuid not null references public.profiles(id),
  transaction_datetime  timestamptz not null default now(),
  work_date             date not null,
  territory_id          uuid references public.territories(id),
  city                  text,
  neighborhood          text,
  book_value_total      numeric(12,2) not null default 0 check (book_value_total >= 0),
  donation_amount       numeric(12,2) not null default 0 check (donation_amount >= 0),
  expected_total        numeric(12,2) not null default 0,
  total_paid            numeric(12,2) not null default 0 check (total_paid >= 0),
  payment_difference    numeric(12,2) not null default 0,
  status                text not null default 'completed' check (status in ('draft','completed','cancelled')),
  customer_id           uuid references public.customers(id),
  notes                 text,
  cancelled_reason      text,
  cancelled_by          uuid references public.profiles(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create index on public.transactions (user_id, work_date);

create table public.transaction_items (
  id              uuid primary key default gen_random_uuid(),
  transaction_id  uuid not null references public.transactions(id),
  book_id         uuid not null references public.books(id),
  book_code       text not null,
  quantity        int not null check (quantity > 0),
  unit_value      numeric(10,2) not null check (unit_value >= 0),
  line_total      numeric(12,2) not null
);
create index on public.transaction_items (transaction_id);

create table public.donations (
  id                 uuid primary key default gen_random_uuid(),
  transaction_id     uuid references public.transactions(id),
  user_id            uuid not null references public.profiles(id),
  donor_name         text,
  donor_email        text,
  donation_datetime  timestamptz not null default now(),
  amount             numeric(12,2) not null check (amount > 0),
  method             text,
  notes              text
);
create index on public.donations (transaction_id);

create table public.payments (
  id                uuid primary key default gen_random_uuid(),
  transaction_id    uuid not null references public.transactions(id),
  user_id           uuid not null references public.profiles(id),
  payment_datetime  timestamptz not null default now(),
  amount            numeric(12,2) not null check (amount > 0),
  method            text not null,
  reference         text,
  status            text not null default 'received' check (status in ('received','void')),
  created_at        timestamptz not null default now()
);
create index on public.payments (transaction_id);

-- ───────────────────────── Reconciliation ─────────────────────────
create table public.daily_reconciliations (
  id                   uuid primary key default gen_random_uuid(),
  student_id           uuid not null references public.profiles(id),
  leader_id            uuid references public.profiles(id),
  work_date            date not null,
  session_id           uuid references public.work_sessions(id),
  expected_book_value  numeric(12,2) not null default 0,
  expected_donations   numeric(12,2) not null default 0,
  expected_total       numeric(12,2) not null default 0,
  recorded_received    numeric(12,2) not null default 0,
  cash_submitted       numeric(12,2) not null default 0 check (cash_submitted >= 0),
  whish_submitted      numeric(12,2) not null default 0 check (whish_submitted >= 0),
  other_submitted      numeric(12,2) not null default 0 check (other_submitted >= 0),
  total_submitted      numeric(12,2) not null default 0,
  money_difference     numeric(12,2) not null default 0,
  books_expected       int not null default 0,
  books_returned       int not null default 0,
  books_counted        int,
  book_difference      int not null default 0,
  status               text not null default 'pending' check (status in ('pending','balanced','difference','approved','locked')),
  override_used        boolean not null default false,
  approved_by          uuid references public.profiles(id),
  approved_at          timestamptz,
  notes                text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  unique (student_id, work_date)
);

create table public.follow_ups (
  id                 uuid primary key default gen_random_uuid(),
  customer_id        uuid not null references public.customers(id),
  created_date       date not null default current_date,
  follow_up_type     text not null default 'Visit',
  assigned_to        uuid not null references public.profiles(id),
  created_by         uuid references public.profiles(id),
  due_date           date,
  status             text not null default 'new' check (status in ('new','contacted','follow_up_again','completed','closed')),
  last_contact_date  date,
  outcome            text,
  notes              text,
  created_at         timestamptz not null default now()
);

create table public.audit_log (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid references public.profiles(id),
  action       text not null,
  entity_type  text,
  entity_id    uuid,
  old_value    jsonb,
  new_value    jsonb,
  created_at   timestamptz not null default now(),
  device       text
);
create index on public.audit_log (created_at desc);
