-- YES Canvassing App — pause/resume and location-stamped work events
--
-- Every work event (start, pause, resume, stop, each transaction, and a ping every
-- ~10 minutes while the app is open during a session) is stored with the time and,
-- when the phone shares it, the GPS position and the city/neighborhood it resolves to.
-- Location is collected only during a work session and is personal data: it is
-- covered by the privacy notice (Law 81/2018, Art. 88) and visible only to the
-- student, their leader and admins (RLS below).

-- ───────── Sessions can be paused; paused time is not work time ─────────
alter table public.work_sessions drop constraint if exists work_sessions_check;
alter table public.work_sessions drop constraint if exists work_sessions_status_check;
alter table public.work_sessions
  add column if not exists paused_at timestamptz,
  add column if not exists paused_minutes int not null default 0 check (paused_minutes >= 0),
  add constraint work_sessions_status_check check (status in ('active','paused','completed','auto_closed')),
  add constraint work_sessions_open_check check ((status in ('active','paused')) = (ended_at is null)),
  add constraint work_sessions_paused_check check ((status = 'paused') = (paused_at is not null));

alter table public.app_settings
  add column if not exists location_required boolean not null default false;

-- ───────── Events ─────────
create table public.work_session_events (
  id               uuid primary key default gen_random_uuid(),
  session_id       uuid not null references public.work_sessions(id),
  user_id          uuid not null references public.profiles(id),
  event_type       text not null check (event_type in ('start','pause','resume','stop','ping','transaction','closed_by_leader')),
  occurred_at      timestamptz not null default now(),
  latitude         numeric(9,6) check (latitude between -90 and 90),
  longitude        numeric(9,6) check (longitude between -180 and 180),
  accuracy_m       int check (accuracy_m >= 0),
  city             text check (length(city) <= 80),
  neighborhood     text check (length(neighborhood) <= 80),
  location_status  text not null default 'unavailable' check (location_status in ('ok','denied','unavailable','timeout')),
  transaction_id   uuid,
  created_at       timestamptz not null default now(),
  check ((latitude is null) = (longitude is null))
);
create index on public.work_session_events (session_id, occurred_at);
create index on public.work_session_events (user_id, occurred_at desc);

alter table public.work_session_events enable row level security;
create policy session_events_read on public.work_session_events for select to authenticated using (can_view_user(user_id));
revoke insert, update, delete on public.work_session_events from anon, authenticated;
revoke all on public.work_session_events from anon;

-- Minutes actually worked: wall time minus pauses (a paused session stops its clock).
create or replace function public.session_minutes(s public.work_sessions) returns int
language sql stable set search_path = public as $$
  select greatest(0, case
    when s.status = 'active' then round(extract(epoch from now() - s.started_at) / 60)::int - s.paused_minutes
    when s.status = 'paused' then round(extract(epoch from s.paused_at - s.started_at) / 60)::int - s.paused_minutes
    else coalesce(s.duration_minutes, 0) end)
$$;

-- p_loc = {lat, lng, accuracy, city, neighborhood, status}
create or replace function public.record_session_event(
  p_session uuid, p_user uuid, p_type text, p_loc jsonb, p_at timestamptz default now(), p_tx uuid default null
) returns void
language plpgsql security definer set search_path = public as $$
declare
  v_lat numeric; v_lng numeric; v_status text := coalesce(p_loc->>'status', 'unavailable');
begin
  if v_status not in ('ok','denied','unavailable','timeout') then v_status := 'unavailable'; end if;
  begin
    v_lat := nullif(p_loc->>'lat', '')::numeric;
    v_lng := nullif(p_loc->>'lng', '')::numeric;
  exception when others then v_lat := null; v_lng := null;
  end;
  if v_lat is null or v_lng is null or v_lat not between -90 and 90 or v_lng not between -180 and 180 then
    v_lat := null; v_lng := null;
    if v_status = 'ok' then v_status := 'unavailable'; end if;
  end if;
  insert into work_session_events (session_id, user_id, event_type, occurred_at, latitude, longitude, accuracy_m,
                                   city, neighborhood, location_status, transaction_id)
  values (p_session, p_user, p_type, coalesce(p_at, now()), round(v_lat, 6), round(v_lng, 6),
          least(greatest(nullif(p_loc->>'accuracy', '')::numeric, 0), 100000)::int,
          left(nullif(trim(p_loc->>'city'), ''), 80), left(nullif(trim(p_loc->>'neighborhood'), ''), 80),
          v_status, p_tx);
end $$;

-- ───────── Work session RPCs (replace the location-less versions) ─────────
drop function if exists public.start_work();
drop function if exists public.stop_work(uuid);

create or replace function public.start_work(p_loc jsonb default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare
  me profiles := require_active_me();
  s  work_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('session:' || me.id::text, 0));
  if not coalesce((select allow_multiple_sessions from app_settings where id = 1), false)
     and exists (select 1 from work_sessions where user_id = me.id and status in ('active','paused')) then
    raise exception 'You already have an active work session.';
  end if;
  if coalesce((select location_required from app_settings where id = 1), false)
     and coalesce(p_loc->>'status', '') <> 'ok' then
    raise exception 'Turn on location to start work. Your leader requires it.';
  end if;
  insert into work_sessions (user_id, work_date, started_at, last_heartbeat, status)
  values (me.id, app_today(), now(), now(), 'active')
  returning * into s;
  perform record_session_event(s.id, me.id, 'start', p_loc);
  return s;
end $$;

create or replace function public.pause_work(p_loc jsonb default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me(); s work_sessions;
begin
  select * into s from work_sessions where user_id = me.id and status = 'active' order by started_at desc limit 1 for update;
  if not found then raise exception 'You have no active work session to pause.'; end if;
  update work_sessions set status = 'paused', paused_at = now(), last_heartbeat = now() where id = s.id returning * into s;
  perform record_session_event(s.id, me.id, 'pause', p_loc);
  return s;
end $$;

create or replace function public.resume_work(p_loc jsonb default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me(); s work_sessions;
begin
  select * into s from work_sessions where user_id = me.id and status = 'paused' order by started_at desc limit 1 for update;
  if not found then raise exception 'Your work is not paused.'; end if;
  update work_sessions
     set status = 'active',
         paused_minutes = paused_minutes + greatest(0, round(extract(epoch from now() - paused_at) / 60)::int),
         paused_at = null, last_heartbeat = now()
   where id = s.id returning * into s;
  perform record_session_event(s.id, me.id, 'resume', p_loc);
  return s;
end $$;

create or replace function public.stop_work(p_session uuid default null, p_loc jsonb default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare
  me profiles := require_active_me();
  s  work_sessions;
begin
  select * into s from work_sessions
   where user_id = me.id and status in ('active','paused') and (p_session is null or id = p_session)
   order by started_at desc limit 1
   for update;
  if not found then raise exception 'You have no active work session.'; end if;
  update work_sessions
     set paused_minutes = paused_minutes + case when status = 'paused'
                            then greatest(0, round(extract(epoch from now() - paused_at) / 60)::int) else 0 end,
         paused_at = null
   where id = s.id returning * into s;
  update work_sessions
     set ended_at = now(), status = 'completed',
         duration_minutes = greatest(0, round(extract(epoch from now() - started_at) / 60)::int - paused_minutes)
   where id = s.id
   returning * into s;
  perform record_session_event(s.id, me.id, 'stop', p_loc);
  return s;
end $$;

create or replace function public.staff_stop_session(p_session uuid, p_notes text default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare s work_sessions;
begin
  perform require_active_me();
  select * into s from work_sessions where id = p_session and status in ('active','paused') for update;
  if not found then raise exception 'That session is not active.'; end if;
  if not can_manage_user(s.user_id) then raise exception 'You are not allowed to manage this student.'; end if;
  update work_sessions
     set paused_minutes = paused_minutes + case when status = 'paused'
                            then greatest(0, round(extract(epoch from now() - paused_at) / 60)::int) else 0 end,
         paused_at = null
   where id = s.id returning * into s;
  update work_sessions
     set ended_at = now(), status = 'auto_closed',
         duration_minutes = greatest(0, round(extract(epoch from now() - started_at) / 60)::int - paused_minutes),
         notes = left(concat_ws(' · ', notes, nullif(trim(p_notes), '')), 1000)
   where id = s.id returning * into s;
  perform record_session_event(s.id, s.user_id, 'closed_by_leader', null);
  perform log_audit('Leader stopped a student session', 'work_session', s.id, null, to_jsonb(s));
  return s;
end $$;

-- Periodic position while working (the app sends one every ~10 minutes while open).
create or replace function public.log_location(p_loc jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me(); s work_sessions;
begin
  select * into s from work_sessions where user_id = me.id and status = 'active' order by started_at desc limit 1;
  if not found then return; end if;  -- not working (or paused): nothing is recorded
  -- at most one ping every 4 minutes, whatever the client sends
  if exists (select 1 from work_session_events where session_id = s.id and event_type = 'ping'
              and occurred_at > now() - interval '4 minutes') then return; end if;
  update work_sessions set last_heartbeat = now() where id = s.id;
  perform record_session_event(s.id, me.id, 'ping', p_loc);
end $$;

-- Live list for leaders: status, where they started, and when/where they were last seen.
drop function if exists public.active_sessions();
create or replace function public.active_sessions()
returns table (session_id uuid, user_id uuid, full_name text, team_name text, started_at timestamptz,
               last_heartbeat timestamptz, presentations int, status text, paused_at timestamptz,
               start_place text, last_seen_at timestamptz, last_place text, last_lat numeric, last_lng numeric,
               location_status text)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, p.full_name, t.team_name, s.started_at, s.last_heartbeat, s.presentations, s.status, s.paused_at,
         (select concat_ws(', ', e.neighborhood, e.city) from work_session_events e
           where e.session_id = s.id and e.event_type = 'start' limit 1),
         l.occurred_at, concat_ws(', ', l.neighborhood, l.city), l.latitude, l.longitude, l.location_status
    from work_sessions s
    join profiles p on p.id = s.user_id
    left join teams t on t.id = p.team_id
    left join lateral (select * from work_session_events e where e.session_id = s.id
                        order by e.occurred_at desc limit 1) l on true
   where s.status in ('active','paused') and can_view_user(s.user_id)
   order by s.started_at
$$;

-- ───────── Existing functions, updated for pauses and location ─────────
create or replace function public.create_transaction(p jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me          profiles := require_active_me();
  v_id        uuid := coalesce(nullif(p->>'id', '')::uuid, gen_random_uuid());
  v_owner     uuid;
  v_session   work_sessions;
  v_when      timestamptz := coalesce(nullif(p->>'client_created_at', '')::timestamptz, now());
  v_items     jsonb := coalesce(p->'items', '[]'::jsonb);
  v_pays      jsonb := coalesce(p->'payments', '[]'::jsonb);
  v_don       numeric(12,2) := coalesce(nullif(p->'donation'->>'amount', '')::numeric, 0);
  v_methods   text[];
  v_line      record;
  v_book      books;
  v_remaining int;
  v_pay       jsonb;
  v_amt       numeric(12,2);
  v_book_tot  numeric(12,2) := 0;
  v_paid      numeric(12,2) := 0;
  v_cust      jsonb := p->'customer';
  v_consent   boolean;
  v_cust_id   uuid;
begin
  -- Idempotency: the same id can only ever create one transaction.
  perform pg_advisory_xact_lock(hashtextextended('tx:' || v_id::text, 0));
  select user_id into v_owner from transactions where id = v_id;
  if found then
    if v_owner <> me.id then raise exception 'Duplicate transaction id.'; end if;
    return transaction_summary(v_id) || jsonb_build_object('duplicate', true);
  end if;

  -- Work session: the one captured on the phone, or the current active one.
  if nullif(p->>'session_id', '') is not null then
    select * into v_session from work_sessions where id = (p->>'session_id')::uuid and user_id = me.id;
    if not found then raise exception 'Work session not found.'; end if;
  else
    select * into v_session from work_sessions
     where user_id = me.id and status in ('active','paused') order by started_at desc limit 1;
    if not found then raise exception 'Start work before recording a transaction.'; end if;
    if v_session.status = 'paused' then raise exception 'Your work is paused. Resume work to record a transaction.'; end if;
  end if;
  if v_when > now() + interval '5 minutes' or v_when < now() - interval '7 days' then v_when := now(); end if;

  -- Validation
  if jsonb_typeof(v_items) <> 'array' or jsonb_typeof(v_pays) <> 'array' then
    raise exception 'Invalid transaction data.';
  end if;
  if v_don < 0 then raise exception 'Donation cannot be negative.'; end if;
  if v_don > 0 and not coalesce((select donations_enabled from app_settings where id = 1), true) then
    raise exception 'Donations are disabled.';
  end if;
  if exists (select 1 from jsonb_array_elements(v_items) x
              where coalesce(nullif(x->>'quantity', '')::numeric, 0) < 1
                 or (x->>'quantity')::numeric <> trunc((x->>'quantity')::numeric)) then
    raise exception 'Each book quantity must be a whole number of at least 1.';
  end if;
  if jsonb_array_length(v_items) = 0 and v_don = 0 then
    raise exception 'Add at least one book or a donation.';
  end if;
  select payment_methods into v_methods from app_settings where id = 1;

  insert into transactions (id, session_id, user_id, transaction_datetime, work_date, territory_id,
                            city, neighborhood, donation_amount, status, notes)
  values (v_id, v_session.id, me.id, v_when, (v_when at time zone app_tz())::date,
          nullif(p->>'territory_id', '')::uuid, nullif(trim(p->>'city'), ''),
          nullif(trim(p->>'neighborhood'), ''), v_don, 'completed', nullif(trim(p->>'notes'), ''));

  -- Books: merge duplicate lines, lock inventory rows, refuse to go negative.
  for v_line in
    select (x->>'book_id')::uuid as book_id, sum((x->>'quantity')::int)::int as qty
      from jsonb_array_elements(v_items) x group by 1 order by 1
  loop
    select * into v_book from books where id = v_line.book_id;
    if not found or not v_book.active then raise exception 'One of the books is not available.'; end if;
    if v_book.unit_value is null then
      raise exception 'Book % has no price yet. Ask your admin to set it.', v_book.code;
    end if;
    select remaining into v_remaining from inventory
     where user_id = me.id and book_id = v_book.id for update;
    if coalesce(v_remaining, 0) < v_line.qty then
      raise exception 'Not enough inventory of %. You currently have % copies available.',
        v_book.code, coalesce(v_remaining, 0);
    end if;
    insert into transaction_items (transaction_id, book_id, book_code, quantity, unit_value, line_total)
    values (v_id, v_book.id, v_book.code, v_line.qty, v_book.unit_value, v_line.qty * v_book.unit_value);
    update inventory set distributed = distributed + v_line.qty, updated_at = now()
     where user_id = me.id and book_id = v_book.id;
    insert into inventory_movements (user_id, book_id, movement_type, quantity, related_transaction_id, performed_by)
    values (me.id, v_book.id, 'SALE', v_line.qty, v_id, me.id);
    v_book_tot := v_book_tot + v_line.qty * v_book.unit_value;
  end loop;

  -- Donation (kept separate from book value)
  if v_don > 0 then
    insert into donations (transaction_id, user_id, donor_name, donor_email, donation_datetime, amount, method, notes)
    values (v_id, me.id, nullif(trim(p->'donation'->>'donor_name'), ''), nullif(trim(p->'donation'->>'donor_email'), ''),
            v_when, v_don, nullif(p->'donation'->>'method', ''), nullif(trim(p->'donation'->>'notes'), ''));
  end if;

  -- Payments (several allowed: e.g. part cash, part Whish)
  for v_pay in select * from jsonb_array_elements(v_pays) loop
    v_amt := coalesce(nullif(v_pay->>'amount', '')::numeric, 0);
    if v_amt = 0 then continue; end if;
    if v_amt < 0 then raise exception 'Payment amounts cannot be negative.'; end if;
    if not ((v_pay->>'method') = any (v_methods)) then raise exception 'Invalid payment method.'; end if;
    insert into payments (transaction_id, user_id, payment_datetime, amount, method, reference)
    values (v_id, me.id, v_when, v_amt, v_pay->>'method', nullif(trim(v_pay->>'reference'), ''));
    v_paid := v_paid + v_amt;
  end loop;

  -- Optional customer. Phone/WhatsApp/email are dropped unless the person consented.
  if v_cust is not null and jsonb_typeof(v_cust) = 'object'
     and coalesce(nullif(trim(v_cust->>'name'), ''), nullif(trim(v_cust->>'phone'), ''),
                  nullif(trim(v_cust->>'whatsapp'), ''), nullif(trim(v_cust->>'email'), ''),
                  nullif(trim(v_cust->>'notes'), '')) is not null then
    v_consent := coalesce((v_cust->>'consent')::boolean, false);
    insert into customers (created_by, name, phone, whatsapp, email, city, neighborhood, notes, consent, consent_date)
    values (me.id, nullif(trim(v_cust->>'name'), ''),
            case when v_consent then nullif(trim(v_cust->>'phone'), '') end,
            case when v_consent then nullif(trim(v_cust->>'whatsapp'), '') end,
            case when v_consent then nullif(trim(v_cust->>'email'), '') end,
            coalesce(nullif(trim(v_cust->>'city'), ''), nullif(trim(p->>'city'), '')),
            coalesce(nullif(trim(v_cust->>'neighborhood'), ''), nullif(trim(p->>'neighborhood'), '')),
            nullif(trim(v_cust->>'notes'), ''), v_consent, case when v_consent then now() end)
    returning id into v_cust_id;
  end if;

  update transactions
     set book_value_total   = v_book_tot,
         expected_total     = v_book_tot + v_don,
         total_paid         = v_paid,
         payment_difference = v_paid - (v_book_tot + v_don),
         customer_id        = v_cust_id,
         updated_at         = now()
   where id = v_id;

  if p ? 'location' and jsonb_typeof(p->'location') = 'object' then
    perform record_session_event(v_session.id, me.id, 'transaction', p->'location', v_when, v_id);
  end if;

  perform log_audit('Student completed transaction', 'transaction', v_id, null,
                    jsonb_build_object('book_value', v_book_tot, 'donation', v_don, 'paid', v_paid));
  return transaction_summary(v_id) || jsonb_build_object('duplicate', false);
end $$;

create or replace function public.report_summary(
  p_from date default null, p_to date default null,
  p_user uuid default null, p_team uuid default null, p_leader uuid default null,
  p_territory uuid default null, p_book uuid default null, p_method text default null
) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_from date := coalesce(p_from, '2000-01-01'::date);
  v_to   date := coalesce(p_to, app_today());
  result jsonb;
begin
  perform require_active_me();
  with
  users as (
    select u.id, u.full_name, u.team_id from profiles u
     where can_view_user(u.id)
       and (p_user is null or u.id = p_user)
       and (p_team is null or u.team_id = p_team)
       and (p_leader is null or u.leader_id = p_leader
            or u.team_id in (select id from teams where leader_id = p_leader))
  ),
  tx as (
    select t.* from transactions t join users u on u.id = t.user_id
     where t.status = 'completed' and t.work_date between v_from and v_to
       and (p_territory is null or t.territory_id = p_territory)
       and (p_book is null or exists (select 1 from transaction_items i where i.transaction_id = t.id and i.book_id = p_book))
       and (p_method is null or exists (select 1 from payments y where y.transaction_id = t.id and y.method = p_method and y.status = 'received'))
  ),
  items as (
    select i.*, t.user_id from transaction_items i join tx t on t.id = i.transaction_id
     where p_book is null or i.book_id = p_book
  ),
  pays as (
    select y.*, t.user_id as tx_user from payments y join tx t on t.id = y.transaction_id
     where y.status = 'received' and (p_method is null or y.method = p_method)
  ),
  sess as (
    select s.*, session_minutes(s) as minutes
      from work_sessions s join users u on u.id = s.user_id
     where s.work_date between v_from and v_to
  ),
  per_user as (
    select u.id, u.full_name,
      coalesce((select sum(minutes) from sess where user_id = u.id), 0) as minutes,
      coalesce((select sum(presentations) from sess where user_id = u.id), 0) as presentations,
      exists (select 1 from sess where user_id = u.id and status = 'active') as working,
      coalesce((select sum(quantity) from items where user_id = u.id), 0) as books,
      coalesce((select sum(book_value_total) from tx where user_id = u.id), 0) as book_value,
      coalesce((select sum(donation_amount) from tx where user_id = u.id), 0) as donations,
      coalesce((select sum(amount) from pays where tx_user = u.id), 0) as received,
      (select count(*) from tx where user_id = u.id) as transactions
    from users u
  )
  select jsonb_build_object(
    'from', v_from, 'to', v_to,
    'work_minutes', coalesce((select sum(minutes) from sess), 0),
    'active_minutes', coalesce((select sum(minutes) from sess where status in ('active','paused')), 0),
    'presentations', coalesce((select sum(presentations) from sess), 0),
    'working_now', (select count(distinct user_id) from sess where status = 'active'),
    'students_active', (select count(*) from per_user where minutes > 0 or transactions > 0),
    'books_distributed', coalesce((select sum(quantity) from items), 0),
    'book_value', coalesce((select sum(book_value_total) from tx), 0),
    'donations', coalesce((select sum(donation_amount) from tx), 0),
    'expected', coalesce((select sum(expected_total) from tx), 0),
    'received', coalesce((select sum(amount) from pays), 0),
    'transactions', (select count(*) from tx),
    'by_book', coalesce((
        select jsonb_agg(jsonb_build_object('code', b.code, 'name', b.name, 'quantity', x.q, 'value', x.v) order by x.q desc, b.code)
          from (select book_id, sum(quantity) q, sum(line_total) v from items group by book_id) x
          join books b on b.id = x.book_id), '[]'::jsonb),
    'by_method', coalesce((select jsonb_object_agg(method, total) from (select method, sum(amount) total from pays group by method) m), '{}'::jsonb),
    'by_user', coalesce((
        select jsonb_agg(to_jsonb(pu) order by pu.working desc, pu.received desc, pu.full_name)
          from per_user pu where pu.minutes > 0 or pu.transactions > 0 or pu.working), '[]'::jsonb)
  ) into result;
  return result;
end $$;

create or replace function public.day_summary(p_student uuid, p_date date) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  s profiles; r daily_reconciliations; result jsonb;
begin
  perform require_active_me();
  if not can_view_user(p_student) then raise exception 'You are not allowed to see this student.'; end if;
  select * into s from profiles where id = p_student;
  select * into r from daily_reconciliations where student_id = p_student and work_date = p_date;
  with
  tx as (select * from transactions where user_id = p_student and work_date = p_date and status = 'completed'),
  mv as (select * from inventory_movements
          where user_id = p_student and (created_at at time zone app_tz())::date = p_date),
  pays as (select y.* from payments y join tx on tx.id = y.transaction_id where y.status = 'received')
  select jsonb_build_object(
    'student', jsonb_build_object('id', s.id, 'full_name', s.full_name, 'email', s.email),
    'date', p_date,
    'has_active_session', exists (select 1 from work_sessions where user_id = p_student and status in ('active','paused')),
    'active_session_id', (select id from work_sessions where user_id = p_student and status in ('active','paused') order by started_at desc limit 1),
    'work_minutes', coalesce((select sum(session_minutes(w)) from work_sessions w where w.user_id = p_student and w.work_date = p_date), 0),
    'presentations', coalesce((select sum(presentations) from work_sessions where user_id = p_student and work_date = p_date), 0),
    'books', jsonb_build_object(
      'assigned',    coalesce((select sum(quantity) from mv where movement_type in ('ASSIGN','TRANSFER_IN')), 0),
      'distributed', coalesce((select sum(quantity) from transaction_items i join tx on tx.id = i.transaction_id), 0),
      'returned',    coalesce((select sum(quantity) from mv where movement_type in ('RETURN','TRANSFER_OUT')), 0),
      'remaining',   coalesce((select sum(remaining) from inventory where user_id = p_student), 0)),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('book_id', b.id, 'code', b.code, 'name', b.name, 'remaining', i.remaining) order by b.sort_order, b.code)
                             from inventory i join books b on b.id = i.book_id
                            where i.user_id = p_student and i.remaining > 0), '[]'::jsonb),
    'finance', jsonb_build_object(
      'book_value', coalesce((select sum(book_value_total) from tx), 0),
      'donations',  coalesce((select sum(donation_amount) from tx), 0),
      'expected',   coalesce((select sum(expected_total) from tx), 0)),
    'payments', jsonb_build_object(
      'cash',  coalesce((select sum(amount) from pays where method = 'cash'), 0),
      'whish', coalesce((select sum(amount) from pays where method = 'whish'), 0),
      'other', coalesce((select sum(amount) from pays where method not in ('cash','whish')), 0),
      'total', coalesce((select sum(amount) from pays), 0)),
    'transactions', (select count(*) from tx),
    'reconciliation', case when r.id is null then null else to_jsonb(r) end
  ) into result;
  return result;
end $$;

create or replace function public.approve_day(p_id uuid, p_notes text default null) returns daily_reconciliations
language plpgsql security definer set search_path = public as $$
declare r daily_reconciliations;
begin
  perform require_active_me();
  select * into r from daily_reconciliations where id = p_id for update;
  if not found then raise exception 'Close the day before approving it.'; end if;
  if not can_manage_user(r.student_id) then raise exception 'You are not allowed to approve this day.'; end if;
  if r.status in ('approved','locked') then raise exception 'This day is already approved.'; end if;
  if exists (select 1 from work_sessions where user_id = r.student_id and status in ('active','paused') and work_date <= r.work_date)
     and not r.override_used then
    raise exception 'This student still has an active work session. Stop the session before closing the day.';
  end if;
  if r.status = 'difference' and coalesce(trim(coalesce(p_notes, r.notes)), '') = '' then
    raise exception 'Add discrepancy notes before approving a day with differences.';
  end if;
  update daily_reconciliations
     set status = 'approved', approved_by = auth.uid(), approved_at = now(),
         notes = coalesce(nullif(trim(p_notes), ''), notes), updated_at = now()
   where id = p_id returning * into r;
  perform log_audit('Leader approved reconciliation', 'daily_reconciliation', r.id, null, to_jsonb(r));
  return r;
end $$;

create or replace function public.admin_set_active(p_user uuid, p_active boolean) returns profiles
language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_admin() then raise exception 'Only an admin can activate or deactivate users.'; end if;
  if p_user = auth.uid() and not p_active then raise exception 'You cannot deactivate yourself.'; end if;
  update profiles set active = p_active where id = p_user returning * into u;
  if u.id is null then raise exception 'User not found.'; end if;
  if not p_active then
    update work_sessions
       set status = 'auto_closed', ended_at = now(), paused_at = null,
           duration_minutes = session_minutes(work_sessions)
     where user_id = p_user and status in ('active','paused');
  end if;
  perform log_audit(case when p_active then 'Admin activated user' else 'Admin deactivated user' end,
                    'profile', p_user, null, jsonb_build_object('active', p_active));
  return u;
end $$;

create or replace function public.export_my_data() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me();
begin
  perform log_audit('User exported their data', 'profile', me.id);
  return jsonb_build_object(
    'generated_at', now(),
    'controller', (select data_controller from app_settings where id = 1),
    'profile', to_jsonb(me),
    'work_sessions', coalesce((select jsonb_agg(to_jsonb(s) order by s.started_at) from work_sessions s where s.user_id = me.id), '[]'),
    'work_session_events', coalesce((select jsonb_agg(to_jsonb(e) order by e.occurred_at) from work_session_events e where e.user_id = me.id), '[]'),
    'inventory', coalesce((select jsonb_agg(jsonb_build_object('book', b.code, 'assigned', i.assigned, 'distributed', i.distributed,
                                     'returned', i.returned, 'remaining', i.remaining))
                             from inventory i join books b on b.id = i.book_id where i.user_id = me.id), '[]'),
    'transactions', coalesce((select jsonb_agg(to_jsonb(t) || jsonb_build_object(
                                 'items', (select coalesce(jsonb_agg(to_jsonb(x)), '[]') from transaction_items x where x.transaction_id = t.id),
                                 'payments', (select coalesce(jsonb_agg(to_jsonb(y)), '[]') from payments y where y.transaction_id = t.id))
                               order by t.transaction_datetime) from transactions t where t.user_id = me.id), '[]'),
    'donations', coalesce((select jsonb_agg(to_jsonb(d)) from donations d where d.user_id = me.id), '[]'),
    'customers_recorded', coalesce((select jsonb_agg(to_jsonb(c)) from customers c where c.created_by = me.id), '[]'),
    'daily_reconciliations', coalesce((select jsonb_agg(to_jsonb(r)) from daily_reconciliations r where r.student_id = me.id), '[]')
  );
end $$;

-- ───────── Privileges ─────────
revoke execute on function public.record_session_event(uuid, uuid, text, jsonb, timestamptz, uuid) from public, anon, authenticated;
revoke execute on function public.start_work(jsonb), public.pause_work(jsonb), public.resume_work(jsonb),
  public.stop_work(uuid, jsonb), public.staff_stop_session(uuid, text), public.log_location(jsonb),
  public.active_sessions(), public.session_minutes(public.work_sessions) from public, anon;
grant execute on function public.start_work(jsonb), public.pause_work(jsonb), public.resume_work(jsonb),
  public.stop_work(uuid, jsonb), public.staff_stop_session(uuid, text), public.log_location(jsonb),
  public.active_sessions(), public.session_minutes(public.work_sessions) to authenticated;
