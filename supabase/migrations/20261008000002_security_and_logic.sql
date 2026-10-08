-- YES Canvassing App — permissions (RLS) and business logic (RPCs)
--
-- Rule of the house: the browser can READ what its role allows (RLS) but every
-- write that touches money, inventory, roles or sessions goes through a
-- SECURITY DEFINER function below, which re-checks permissions and runs as one
-- atomic database transaction (a failure anywhere rolls back everything).

-- ═════════════════════════ Helpers ═════════════════════════
create or replace function public.app_tz() returns text
language sql stable security definer set search_path = public as $$
  select coalesce((select timezone from app_settings where id = 1), 'Asia/Beirut')
$$;

create or replace function public.app_today() returns date
language sql stable security definer set search_path = public as $$
  select (now() at time zone app_tz())::date
$$;

create or replace function public.my_role() returns text
language sql stable security definer set search_path = public as $$
  select role from profiles where id = auth.uid() and active
$$;

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'admin', false)
$$;

create or replace function public.is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() in ('leader','admin'), false)
$$;

-- Does the current (active) leader lead this user, directly or through a team?
create or replace function public.leads_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce(my_role() = 'leader', false) and exists (
    select 1 from profiles s
    where s.id = p_user
      and (s.leader_id = auth.uid()
           or s.team_id in (select t.id from teams t where t.leader_id = auth.uid() and t.active))
  )
$$;

create or replace function public.can_view_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select auth.uid() is not null and my_role() is not null and (
    p_user = auth.uid() or is_admin() or leads_user(p_user)
  )
$$;

create or replace function public.can_manage_user(p_user uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_admin() or leads_user(p_user)
$$;

create or replace function public.log_audit(p_action text, p_entity_type text, p_entity_id uuid,
                                            p_old jsonb default null, p_new jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into audit_log (user_id, action, entity_type, entity_id, old_value, new_value)
  values (auth.uid(), p_action, p_entity_type, p_entity_id, p_old, p_new)
$$;

create or replace function public.require_active_me() returns profiles
language plpgsql stable security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if not found then raise exception 'You are not signed in.'; end if;
  if not me.active then raise exception 'Your account is inactive. Please contact your YES leader.'; end if;
  return me;
end $$;

-- ═════════════════════════ Registration ═════════════════════════
-- Anyone may check a code before signing up (returns only a status word).
create or replace function public.check_access_code(p_code text) returns text
language plpgsql stable security definer set search_path = public as $$
declare r access_codes;
begin
  select * into r from access_codes where code = upper(trim(coalesce(p_code, '')));
  if not found or not r.active then return 'invalid'; end if;
  if r.expires_at is not null and r.expires_at < now() then return 'expired'; end if;
  if r.current_uses >= r.max_uses then return 'used'; end if;
  return 'valid';
end $$;

-- Runs inside the sign-up itself. A sign-up without a valid code is rejected,
-- so nobody can pick their own role. Only the service role (server scripts)
-- can provision users without a code, via app_metadata which browsers can't set.
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code   text := upper(trim(coalesce(new.raw_user_meta_data->>'access_code', '')));
  v_row    access_codes;
  v_role   text := 'student';
  v_team   uuid;
  v_leader uuid;
  v_name   text := coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1));
begin
  if coalesce(new.raw_app_meta_data->>'provisioned', '') = 'true' then
    v_role := coalesce(new.raw_app_meta_data->>'role', 'student');
    if v_role not in ('student','leader','admin') then v_role := 'student'; end if;
  else
    select * into v_row from access_codes where code = v_code for update;
    if not found or v_code = '' or not v_row.active then
      raise exception 'Invalid access code. Please contact your YES leader.';
    end if;
    if v_row.expires_at is not null and v_row.expires_at < now() then
      raise exception 'This access code has expired.';
    end if;
    if v_row.current_uses >= v_row.max_uses then
      raise exception 'This access code has already been used.';
    end if;
    v_role := v_row.role;
    v_team := v_row.team_id;
    select leader_id into v_leader from teams where id = v_team;
  end if;

  insert into profiles (id, full_name, email, phone, role, team_id, leader_id)
  values (new.id, v_name, new.email, nullif(trim(new.raw_user_meta_data->>'phone'), ''), v_role, v_team, v_leader);

  if v_row.id is not null then
    update access_codes
       set current_uses = current_uses + 1, used_by = new.id, used_at = now()
     where id = v_row.id;
    insert into access_code_redemptions (access_code_id, user_id) values (v_row.id, new.id);
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, new_value)
  values (new.id,
          case when v_row.id is null then 'User provisioned by server' else 'User registered with access code' end,
          'profile', new.id, jsonb_build_object('role', v_role, 'code', v_row.code));
  return new;
end $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Called right after sign-in. Inactive users get {active:false} and the app signs them out.
create or replace function public.touch_login() returns jsonb
language plpgsql security definer set search_path = public as $$
declare me profiles;
begin
  select * into me from profiles where id = auth.uid();
  if not found then return jsonb_build_object('active', false, 'reason', 'no_profile'); end if;
  if not me.active then return jsonb_build_object('active', false, 'reason', 'inactive'); end if;
  update profiles set last_login = now() where id = me.id;
  return jsonb_build_object('active', true, 'role', me.role);
end $$;

create or replace function public.update_my_profile(p_full_name text, p_phone text, p_language text default null)
returns void language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me();
begin
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required.'; end if;
  update profiles
     set full_name = trim(p_full_name),
         phone = nullif(trim(p_phone), ''),
         preferred_language = coalesce(p_language, preferred_language)
   where id = me.id;
end $$;

-- ═════════════════════════ Work sessions ═════════════════════════
create or replace function public.start_work() returns work_sessions
language plpgsql security definer set search_path = public as $$
declare
  me profiles := require_active_me();
  s  work_sessions;
begin
  perform pg_advisory_xact_lock(hashtextextended('session:' || me.id::text, 0));
  if not coalesce((select allow_multiple_sessions from app_settings where id = 1), false)
     and exists (select 1 from work_sessions where user_id = me.id and status = 'active') then
    raise exception 'You already have an active work session.';
  end if;
  insert into work_sessions (user_id, work_date, started_at, last_heartbeat, status)
  values (me.id, app_today(), now(), now(), 'active')
  returning * into s;
  return s;
end $$;

create or replace function public.stop_work(p_session uuid default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare
  me profiles := require_active_me();
  s  work_sessions;
begin
  select * into s from work_sessions
   where user_id = me.id and status = 'active' and (p_session is null or id = p_session)
   order by started_at desc limit 1
   for update;
  if not found then raise exception 'You have no active work session.'; end if;
  update work_sessions
     set ended_at = now(), status = 'completed',
         duration_minutes = greatest(0, round(extract(epoch from now() - started_at) / 60)::int)
   where id = s.id
   returning * into s;
  return s;
end $$;

-- Leader/Admin closes a session a student forgot to stop.
create or replace function public.staff_stop_session(p_session uuid, p_notes text default null) returns work_sessions
language plpgsql security definer set search_path = public as $$
declare s work_sessions;
begin
  perform require_active_me();
  select * into s from work_sessions where id = p_session and status = 'active' for update;
  if not found then raise exception 'That session is not active.'; end if;
  if not can_manage_user(s.user_id) then raise exception 'You are not allowed to manage this student.'; end if;
  update work_sessions
     set ended_at = now(), status = 'auto_closed',
         duration_minutes = greatest(0, round(extract(epoch from now() - started_at) / 60)::int),
         notes = concat_ws(' · ', notes, nullif(trim(p_notes), ''))
   where id = s.id returning * into s;
  perform log_audit('Leader stopped a student session', 'work_session', s.id, null, to_jsonb(s));
  return s;
end $$;

create or replace function public.session_heartbeat() returns void
language sql security definer set search_path = public as $$
  update work_sessions set last_heartbeat = now() where user_id = auth.uid() and status = 'active'
$$;

-- Presentations counter (+1 / -1) on the active session.
create or replace function public.add_presentations(p_delta int) returns int
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me(); v int;
begin
  update work_sessions set presentations = greatest(0, presentations + p_delta)
   where user_id = me.id and status = 'active'
   returning presentations into v;
  if v is null then raise exception 'Start work before counting presentations.'; end if;
  return v;
end $$;

-- ═════════════════════════ Transactions ═════════════════════════
create or replace function public.transaction_summary(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'id', t.id,
    'status', t.status,
    'books', coalesce((select sum(quantity) from transaction_items where transaction_id = t.id), 0),
    'book_value', t.book_value_total,
    'donation', t.donation_amount,
    'expected', t.expected_total,
    'received', t.total_paid,
    'difference', t.payment_difference,
    'remaining_inventory', coalesce((select sum(remaining) from inventory where user_id = t.user_id), 0)
  )
  from transactions t where t.id = p_id
$$;

-- p = {
--   id: uuid (client-generated, makes the call idempotent),
--   session_id?: uuid, client_created_at?: timestamptz,
--   items: [{book_id, quantity}], donation?: {amount, donor_name, donor_email, method, notes},
--   payments: [{amount, method, reference}], customer?: {name, phone, whatsapp, email, city,
--   neighborhood, notes, consent}, territory_id?, city?, neighborhood?, notes?
-- }
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
     where user_id = me.id and status = 'active' order by started_at desc limit 1;
    if not found then raise exception 'Start work before recording a transaction.'; end if;
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

  perform log_audit('Student completed transaction', 'transaction', v_id, null,
                    jsonb_build_object('book_value', v_book_tot, 'donation', v_don, 'paid', v_paid));
  return transaction_summary(v_id) || jsonb_build_object('duplicate', false);
end $$;

-- A day is frozen once a leader approved (or admin locked) its reconciliation.
create or replace function public.day_is_frozen(p_student uuid, p_date date) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from daily_reconciliations
                  where student_id = p_student and work_date = p_date and status in ('approved','locked'))
$$;

create or replace function public.cancel_transaction(p_id uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare t transactions; it record;
begin
  perform require_active_me();
  select * into t from transactions where id = p_id for update;
  if not found then raise exception 'Transaction not found.'; end if;
  if not can_manage_user(t.user_id) then raise exception 'Only a leader or admin can cancel transactions.'; end if;
  if t.status = 'cancelled' then raise exception 'This transaction is already cancelled.'; end if;
  if day_is_frozen(t.user_id, t.work_date) then raise exception 'That day is already approved and cannot be changed.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please give a reason.'; end if;
  for it in select book_id, quantity from transaction_items where transaction_id = p_id loop
    update inventory set distributed = distributed - it.quantity, updated_at = now()
     where user_id = t.user_id and book_id = it.book_id;
    insert into inventory_movements (user_id, book_id, movement_type, quantity, related_transaction_id, performed_by, notes)
    values (t.user_id, it.book_id, 'CANCEL_SALE', it.quantity, p_id, auth.uid(), p_reason);
  end loop;
  update payments set status = 'void' where transaction_id = p_id;
  update transactions set status = 'cancelled', cancelled_reason = trim(p_reason), cancelled_by = auth.uid(), updated_at = now()
   where id = p_id;
  perform log_audit('Transaction cancelled', 'transaction', p_id, to_jsonb(t), jsonb_build_object('reason', p_reason));
  return transaction_summary(p_id);
end $$;

-- ═════════════════════════ Inventory ═════════════════════════
-- p_items = [{book_id, quantity}]
create or replace function public.assign_inventory(p_student uuid, p_items jsonb, p_notes text default null) returns int
language plpgsql security definer set search_path = public as $$
declare it record; b books; total int := 0;
begin
  perform require_active_me();
  if not can_manage_user(p_student) then raise exception 'You can only assign books to your own students.'; end if;
  if not exists (select 1 from profiles where id = p_student and active) then raise exception 'That student is inactive.'; end if;
  for it in select (x->>'book_id')::uuid as book_id, sum((x->>'quantity')::int)::int as qty
              from jsonb_array_elements(coalesce(p_items, '[]')) x group by 1 loop
    if it.qty is null or it.qty < 1 then raise exception 'Quantities must be at least 1.'; end if;
    select * into b from books where id = it.book_id for update;
    if not found then raise exception 'Book not found.'; end if;
    if b.warehouse_qty < it.qty then
      raise exception 'Not enough % in the warehouse. Available: %.', b.code, b.warehouse_qty;
    end if;
    update books set warehouse_qty = warehouse_qty - it.qty, updated_at = now() where id = b.id;
    insert into inventory (user_id, book_id, assigned) values (p_student, b.id, it.qty)
    on conflict (user_id, book_id) do update set assigned = inventory.assigned + excluded.assigned, updated_at = now();
    insert into inventory_movements (user_id, book_id, movement_type, quantity, performed_by, notes)
    values (p_student, b.id, 'ASSIGN', it.qty, auth.uid(), p_notes);
    total := total + it.qty;
  end loop;
  if total = 0 then raise exception 'Choose at least one book.'; end if;
  perform log_audit('Leader assigned inventory', 'profile', p_student, null, jsonb_build_object('items', p_items, 'total', total));
  return total;
end $$;

create or replace function public.return_inventory(p_student uuid, p_items jsonb, p_notes text default null) returns int
language plpgsql security definer set search_path = public as $$
declare it record; v_rem int; v_code text; total int := 0;
begin
  perform require_active_me();
  if not can_manage_user(p_student) then raise exception 'You can only receive books from your own students.'; end if;
  for it in select (x->>'book_id')::uuid as book_id, sum((x->>'quantity')::int)::int as qty
              from jsonb_array_elements(coalesce(p_items, '[]')) x group by 1 loop
    if it.qty is null or it.qty < 1 then raise exception 'Quantities must be at least 1.'; end if;
    select i.remaining, b.code into v_rem, v_code from inventory i join books b on b.id = i.book_id
     where i.user_id = p_student and i.book_id = it.book_id for update of i;
    if coalesce(v_rem, 0) < it.qty then
      raise exception 'Cannot receive % of %: the student only holds %.', it.qty, coalesce(v_code, 'this book'), coalesce(v_rem, 0);
    end if;
    update inventory set returned = returned + it.qty, updated_at = now() where user_id = p_student and book_id = it.book_id;
    update books set warehouse_qty = warehouse_qty + it.qty, updated_at = now() where id = it.book_id;
    insert into inventory_movements (user_id, book_id, movement_type, quantity, performed_by, notes)
    values (p_student, it.book_id, 'RETURN', it.qty, auth.uid(), p_notes);
    total := total + it.qty;
  end loop;
  if total = 0 then raise exception 'Choose at least one book.'; end if;
  perform log_audit('Leader received returned books', 'profile', p_student, null, jsonb_build_object('items', p_items, 'total', total));
  return total;
end $$;

create or replace function public.transfer_inventory(p_from uuid, p_to uuid, p_book uuid, p_qty int, p_notes text default null) returns void
language plpgsql security definer set search_path = public as $$
declare v_rem int;
begin
  perform require_active_me();
  if p_from = p_to then raise exception 'Choose two different students.'; end if;
  if not (can_manage_user(p_from) and can_manage_user(p_to)) then raise exception 'You can only transfer between your own students.'; end if;
  if coalesce(p_qty, 0) < 1 then raise exception 'Quantity must be at least 1.'; end if;
  select remaining into v_rem from inventory where user_id = p_from and book_id = p_book for update;
  if coalesce(v_rem, 0) < p_qty then raise exception 'Not enough inventory to transfer. Available: %.', coalesce(v_rem, 0); end if;
  update inventory set returned = returned + p_qty, updated_at = now() where user_id = p_from and book_id = p_book;
  insert into inventory (user_id, book_id, assigned) values (p_to, p_book, p_qty)
  on conflict (user_id, book_id) do update set assigned = inventory.assigned + excluded.assigned, updated_at = now();
  insert into inventory_movements (user_id, book_id, movement_type, quantity, performed_by, notes) values
    (p_from, p_book, 'TRANSFER_OUT', p_qty, auth.uid(), p_notes),
    (p_to,   p_book, 'TRANSFER_IN',  p_qty, auth.uid(), p_notes);
  perform log_audit('Inventory transferred', 'book', p_book, null,
                    jsonb_build_object('from', p_from, 'to', p_to, 'quantity', p_qty));
end $$;

-- Admin: receive stock into the warehouse (+) or correct a physical count (±).
create or replace function public.warehouse_adjust(p_book uuid, p_delta int, p_notes text default null) returns int
language plpgsql security definer set search_path = public as $$
declare b books;
begin
  if not is_admin() then raise exception 'Only an admin can adjust warehouse stock.'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'Enter a quantity.'; end if;
  select * into b from books where id = p_book for update;
  if not found then raise exception 'Book not found.'; end if;
  if b.warehouse_qty + p_delta < 0 then raise exception 'Warehouse stock cannot go below zero (currently %).', b.warehouse_qty; end if;
  update books set warehouse_qty = warehouse_qty + p_delta, updated_at = now() where id = p_book;
  insert into inventory_movements (user_id, book_id, movement_type, quantity, performed_by, notes)
  values (null, p_book, case when p_delta > 0 then 'WAREHOUSE_IN' else 'ADJUSTMENT' end, p_delta, auth.uid(), p_notes);
  perform log_audit('Admin performed inventory adjustment', 'book', p_book,
                    jsonb_build_object('warehouse_qty', b.warehouse_qty),
                    jsonb_build_object('warehouse_qty', b.warehouse_qty + p_delta, 'notes', p_notes));
  return b.warehouse_qty + p_delta;
end $$;

-- Admin: correct what a student holds (e.g. a lost book) without faking a sale.
create or replace function public.student_inventory_adjust(p_student uuid, p_book uuid, p_delta int, p_notes text) returns int
language plpgsql security definer set search_path = public as $$
declare v_rem int;
begin
  if not is_admin() then raise exception 'Only an admin can adjust a student''s inventory.'; end if;
  if coalesce(p_delta, 0) = 0 then raise exception 'Enter a quantity.'; end if;
  if coalesce(trim(p_notes), '') = '' then raise exception 'Please explain the adjustment.'; end if;
  insert into inventory (user_id, book_id) values (p_student, p_book) on conflict do nothing;
  select remaining into v_rem from inventory where user_id = p_student and book_id = p_book for update;
  if v_rem + p_delta < 0 then raise exception 'Inventory cannot go below zero (student holds %).', v_rem; end if;
  update inventory set adjusted = adjusted + p_delta, updated_at = now() where user_id = p_student and book_id = p_book;
  insert into inventory_movements (user_id, book_id, movement_type, quantity, performed_by, notes)
  values (p_student, p_book, 'ADJUSTMENT', p_delta, auth.uid(), p_notes);
  perform log_audit('Admin performed inventory adjustment', 'profile', p_student,
                    jsonb_build_object('remaining', v_rem), jsonb_build_object('remaining', v_rem + p_delta, 'book', p_book, 'notes', p_notes));
  return v_rem + p_delta;
end $$;

-- ═════════════════════════ Reports ═════════════════════════
-- One function feeds every dashboard and report. It only ever counts users the
-- caller is allowed to see, so a student asking for "everyone" gets only self.
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
    select s.*, case when s.status = 'active'
                     then greatest(0, round(extract(epoch from now() - s.started_at) / 60)::int)
                     else coalesce(s.duration_minutes, 0) end as minutes
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
    'active_minutes', coalesce((select sum(minutes) from sess where status = 'active'), 0),
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

create or replace function public.active_sessions()
returns table (session_id uuid, user_id uuid, full_name text, team_name text, started_at timestamptz,
               last_heartbeat timestamptz, presentations int)
language sql stable security definer set search_path = public as $$
  select s.id, s.user_id, p.full_name, t.team_name, s.started_at, s.last_heartbeat, s.presentations
    from work_sessions s
    join profiles p on p.id = s.user_id
    left join teams t on t.id = p.team_id
   where s.status = 'active' and can_view_user(s.user_id)
   order by s.started_at
$$;

-- ═════════════════════════ End-of-day reconciliation ═════════════════════════
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
    'has_active_session', exists (select 1 from work_sessions where user_id = p_student and status = 'active'),
    'active_session_id', (select id from work_sessions where user_id = p_student and status = 'active' order by started_at desc limit 1),
    'work_minutes', coalesce((select sum(case when status = 'active'
                                then round(extract(epoch from now() - started_at) / 60)::int
                                else coalesce(duration_minutes, 0) end)
                              from work_sessions where user_id = p_student and work_date = p_date), 0),
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

create or replace function public.close_day(
  p_student uuid, p_date date,
  p_cash numeric, p_whish numeric, p_other numeric,
  p_books_counted int default null, p_notes text default null, p_override boolean default false
) returns daily_reconciliations
language plpgsql security definer set search_path = public as $$
declare
  d jsonb; r daily_reconciliations; v_total numeric(12,2); v_expected numeric(12,2);
  v_book_expected int; v_book_diff int; v_status text; v_active boolean;
begin
  perform require_active_me();
  if not can_manage_user(p_student) then raise exception 'Only the student''s leader or an admin can close the day.'; end if;
  if coalesce(p_cash, 0) < 0 or coalesce(p_whish, 0) < 0 or coalesce(p_other, 0) < 0 then
    raise exception 'Submitted amounts cannot be negative.';
  end if;
  if day_is_frozen(p_student, p_date) then raise exception 'This day is already approved.'; end if;
  perform pg_advisory_xact_lock(hashtextextended('close:' || p_student::text || p_date::text, 0));

  d := day_summary(p_student, p_date);
  v_active := (d->>'has_active_session')::boolean;
  if v_active then
    if not (p_override and is_admin()) then
      raise exception 'This student still has an active work session. Stop the session before closing the day.';
    end if;
    perform log_audit('Admin override: closed day with an active session', 'profile', p_student, null,
                      jsonb_build_object('date', p_date));
  end if;

  v_total := coalesce(p_cash, 0) + coalesce(p_whish, 0) + coalesce(p_other, 0);
  v_expected := (d->'finance'->>'expected')::numeric;
  v_book_expected := (d->'books'->>'remaining')::int;
  v_book_diff := case when p_books_counted is null then 0 else p_books_counted - v_book_expected end;
  v_status := case when v_total = v_expected and v_book_diff = 0 then 'balanced' else 'difference' end;

  insert into daily_reconciliations as x (
    student_id, leader_id, work_date, session_id, expected_book_value, expected_donations, expected_total,
    recorded_received, cash_submitted, whish_submitted, other_submitted, total_submitted, money_difference,
    books_expected, books_returned, books_counted, book_difference, status, override_used, notes)
  values (
    p_student, auth.uid(), p_date,
    (select id from work_sessions where user_id = p_student and work_date = p_date order by started_at desc limit 1),
    (d->'finance'->>'book_value')::numeric, (d->'finance'->>'donations')::numeric, v_expected,
    (d->'payments'->>'total')::numeric, coalesce(p_cash, 0), coalesce(p_whish, 0), coalesce(p_other, 0), v_total,
    v_total - v_expected, v_book_expected, (d->'books'->>'returned')::int, p_books_counted, v_book_diff,
    v_status, v_active, nullif(trim(p_notes), ''))
  on conflict (student_id, work_date) do update set
    leader_id = excluded.leader_id, session_id = excluded.session_id,
    expected_book_value = excluded.expected_book_value, expected_donations = excluded.expected_donations,
    expected_total = excluded.expected_total, recorded_received = excluded.recorded_received,
    cash_submitted = excluded.cash_submitted, whish_submitted = excluded.whish_submitted,
    other_submitted = excluded.other_submitted, total_submitted = excluded.total_submitted,
    money_difference = excluded.money_difference, books_expected = excluded.books_expected,
    books_returned = excluded.books_returned, books_counted = excluded.books_counted,
    book_difference = excluded.book_difference, status = excluded.status,
    override_used = x.override_used or excluded.override_used, notes = excluded.notes, updated_at = now()
  returning * into r;

  perform log_audit('Leader closed day', 'daily_reconciliation', r.id, null, to_jsonb(r));
  return r;
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
  if exists (select 1 from work_sessions where user_id = r.student_id and status = 'active' and work_date <= r.work_date)
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

create or replace function public.lock_day(p_id uuid) returns daily_reconciliations
language plpgsql security definer set search_path = public as $$
declare r daily_reconciliations;
begin
  if not is_admin() then raise exception 'Only an admin can lock a day.'; end if;
  update daily_reconciliations set status = 'locked', updated_at = now()
   where id = p_id and status = 'approved' returning * into r;
  if r.id is null then raise exception 'Only approved days can be locked.'; end if;
  perform log_audit('Admin locked reconciliation', 'daily_reconciliation', r.id, null, to_jsonb(r));
  return r;
end $$;

-- Days with activity that still need a leader's approval.
create or replace function public.pending_days(p_limit int default 100)
returns table (student_id uuid, full_name text, work_date date, status text, transactions bigint, expected numeric)
language sql stable security definer set search_path = public as $$
  with days as (
    select user_id, work_date from work_sessions where can_view_user(user_id) and user_id <> auth.uid()
    union
    select user_id, work_date from transactions where status = 'completed' and can_view_user(user_id) and user_id <> auth.uid()
  )
  select d.user_id, p.full_name, d.work_date, coalesce(r.status, 'pending'),
         (select count(*) from transactions t where t.user_id = d.user_id and t.work_date = d.work_date and t.status = 'completed'),
         coalesce((select sum(expected_total) from transactions t where t.user_id = d.user_id and t.work_date = d.work_date and t.status = 'completed'), 0)
    from days d
    join profiles p on p.id = d.user_id
    left join daily_reconciliations r on r.student_id = d.user_id and r.work_date = d.work_date
   where coalesce(r.status, 'pending') not in ('approved','locked')
     and is_staff()
   order by d.work_date desc, p.full_name
   limit p_limit
$$;

-- ═════════════════════════ Admin ═════════════════════════
create or replace function public.create_access_code(
  p_role text default 'student', p_team uuid default null, p_max_uses int default 1,
  p_expires_at timestamptz default null, p_notes text default null, p_code text default null
) returns access_codes
language plpgsql security definer set search_path = public as $$
declare
  v_code text := upper(trim(coalesce(p_code, '')));
  v_prefix text;
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';  -- no 0/O/1/I/L: easy to read aloud
  bytes bytea; c access_codes; i int;
begin
  if not is_admin() then raise exception 'Only an admin can create access codes.'; end if;
  if p_role not in ('student','leader') then raise exception 'Codes can only create students or leaders.'; end if;
  if coalesce(p_max_uses, 0) < 1 then raise exception 'Max uses must be at least 1.'; end if;
  select access_code_prefix into v_prefix from app_settings where id = 1;
  if v_code = '' then
    loop
      bytes := uuid_send(gen_random_uuid());  -- 122 random bits, no extension needed
      v_code := v_prefix || '-';
      for i in 0..5 loop
        v_code := v_code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
      end loop;
      exit when not exists (select 1 from access_codes where code = v_code);
    end loop;
  elsif exists (select 1 from access_codes where code = v_code) then
    raise exception 'That code already exists.';
  end if;
  insert into access_codes (code, role, team_id, created_by, expires_at, max_uses, notes)
  values (v_code, p_role, p_team, auth.uid(), p_expires_at, p_max_uses, nullif(trim(p_notes), ''))
  returning * into c;
  perform log_audit('Admin created access code', 'access_code', c.id, null, to_jsonb(c));
  return c;
end $$;

create or replace function public.set_access_code_active(p_id uuid, p_active boolean) returns access_codes
language plpgsql security definer set search_path = public as $$
declare c access_codes;
begin
  if not is_admin() then raise exception 'Only an admin can change access codes.'; end if;
  update access_codes set active = p_active where id = p_id returning * into c;
  if c.id is null then raise exception 'Code not found.'; end if;
  perform log_audit(case when p_active then 'Admin activated access code' else 'Admin revoked access code' end,
                    'access_code', c.id, null, to_jsonb(c));
  return c;
end $$;

create or replace function public.admin_set_role(p_user uuid, p_role text) returns profiles
language plpgsql security definer set search_path = public as $$
declare old profiles; u profiles;
begin
  if not is_admin() then raise exception 'Only an admin can change roles.'; end if;
  if p_role not in ('student','leader','admin') then raise exception 'Unknown role.'; end if;
  select * into old from profiles where id = p_user for update;
  if not found then raise exception 'User not found.'; end if;
  if old.role = 'admin' and p_role <> 'admin'
     and (select count(*) from profiles where role = 'admin' and active) <= 1 then
    raise exception 'You cannot remove the last admin.';
  end if;
  update profiles set role = p_role where id = p_user returning * into u;
  perform log_audit('Admin changed user role', 'profile', p_user,
                    jsonb_build_object('role', old.role), jsonb_build_object('role', p_role));
  return u;
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
       set status = 'auto_closed', ended_at = now(),
           duration_minutes = greatest(0, round(extract(epoch from now() - started_at) / 60)::int)
     where user_id = p_user and status = 'active';
  end if;
  perform log_audit(case when p_active then 'Admin activated user' else 'Admin deactivated user' end,
                    'profile', p_user, null, jsonb_build_object('active', p_active));
  return u;
end $$;

create or replace function public.admin_assign_team(p_user uuid, p_team uuid, p_leader uuid default null) returns profiles
language plpgsql security definer set search_path = public as $$
declare old profiles; u profiles; v_leader uuid := p_leader;
begin
  if not is_admin() then raise exception 'Only an admin can change teams.'; end if;
  select * into old from profiles where id = p_user;
  if v_leader is null and p_team is not null then select leader_id into v_leader from teams where id = p_team; end if;
  if v_leader is not null and not exists (select 1 from profiles where id = v_leader and role in ('leader','admin')) then
    raise exception 'The selected leader does not have the Leader role.';
  end if;
  update profiles set team_id = p_team, leader_id = v_leader where id = p_user returning * into u;
  perform log_audit('Admin changed user team', 'profile', p_user,
                    jsonb_build_object('team_id', old.team_id, 'leader_id', old.leader_id),
                    jsonb_build_object('team_id', p_team, 'leader_id', v_leader));
  return u;
end $$;

create or replace function public.admin_update_profile(p_user uuid, p_full_name text, p_phone text) returns profiles
language plpgsql security definer set search_path = public as $$
declare u profiles;
begin
  if not is_admin() then raise exception 'Only an admin can edit users.'; end if;
  if coalesce(trim(p_full_name), '') = '' then raise exception 'Name is required.'; end if;
  update profiles set full_name = trim(p_full_name), phone = nullif(trim(p_phone), '') where id = p_user returning * into u;
  perform log_audit('Admin edited user', 'profile', p_user, null, to_jsonb(u));
  return u;
end $$;

create or replace function public.upsert_team(p_id uuid, p_name text, p_leader uuid, p_active boolean default true, p_notes text default null)
returns teams language plpgsql security definer set search_path = public as $$
declare t teams;
begin
  if not is_admin() then raise exception 'Only an admin can manage teams.'; end if;
  if coalesce(trim(p_name), '') = '' then raise exception 'Team name is required.'; end if;
  if p_leader is not null and not exists (select 1 from profiles where id = p_leader and role in ('leader','admin')) then
    raise exception 'The selected leader does not have the Leader role.';
  end if;
  if p_id is null then
    insert into teams (team_name, leader_id, active, notes) values (trim(p_name), p_leader, p_active, nullif(trim(p_notes), ''))
    returning * into t;
  else
    update teams set team_name = trim(p_name), leader_id = p_leader, active = p_active, notes = nullif(trim(p_notes), '')
     where id = p_id returning * into t;
    if t.id is null then raise exception 'Team not found.'; end if;
    update profiles set leader_id = p_leader where team_id = t.id and role = 'student';
  end if;
  perform log_audit('Admin saved team', 'team', t.id, null, to_jsonb(t));
  return t;
end $$;

-- ═════════════════════════ Audit triggers for direct admin edits ═════════════════════════
create or replace function public.audit_books() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  if tg_op = 'INSERT' then
    perform log_audit('Admin created book', 'book', new.id, null, to_jsonb(new));
  elsif old.unit_value is distinct from new.unit_value then
    perform log_audit('Admin changed book price', 'book', new.id,
                      jsonb_build_object('code', old.code, 'unit_value', old.unit_value),
                      jsonb_build_object('code', new.code, 'unit_value', new.unit_value));
  elsif (old.code, old.name, old.category, old.language, old.active, old.image_url)
        is distinct from (new.code, new.name, new.category, new.language, new.active, new.image_url) then
    perform log_audit('Admin edited book', 'book', new.id, to_jsonb(old), to_jsonb(new));
  end if;
  return new;
end $$;
create trigger books_audit before insert or update on public.books
  for each row execute function public.audit_books();

create or replace function public.audit_generic() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_table_name = 'app_settings' then new.updated_at := now(); end if;
  perform log_audit('Admin edited ' || replace(tg_table_name, '_', ' '), tg_table_name,
                    case when tg_table_name = 'app_settings' then null else (to_jsonb(new)->>'id')::uuid end,
                    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return new;
end $$;
create trigger settings_audit before update on public.app_settings
  for each row execute function public.audit_generic();
create trigger territories_audit before insert or update on public.territories
  for each row execute function public.audit_generic();

-- Books are protected from deletion once used anywhere (FKs do that); users are never deleted.

-- ═════════════════════════ Row Level Security ═════════════════════════
alter table public.app_settings            enable row level security;
alter table public.profiles                enable row level security;
alter table public.teams                   enable row level security;
alter table public.access_codes            enable row level security;
alter table public.access_code_redemptions enable row level security;
alter table public.work_sessions           enable row level security;
alter table public.books                   enable row level security;
alter table public.inventory               enable row level security;
alter table public.inventory_movements     enable row level security;
alter table public.territories             enable row level security;
alter table public.customers               enable row level security;
alter table public.transactions            enable row level security;
alter table public.transaction_items       enable row level security;
alter table public.donations               enable row level security;
alter table public.payments                enable row level security;
alter table public.daily_reconciliations   enable row level security;
alter table public.follow_ups              enable row level security;
alter table public.audit_log               enable row level security;

create policy settings_read   on public.app_settings for select to anon, authenticated using (true);
create policy settings_admin  on public.app_settings for update to authenticated using (is_admin()) with check (is_admin());

create policy profiles_read   on public.profiles for select to authenticated using (can_view_user(id));

create policy teams_read on public.teams for select to authenticated
  using (is_admin() or leader_id = auth.uid() or id = (select team_id from profiles where id = auth.uid()));

create policy codes_admin       on public.access_codes for select to authenticated using (is_admin());
create policy redemptions_admin on public.access_code_redemptions for select to authenticated using (is_admin());

create policy sessions_read on public.work_sessions for select to authenticated using (can_view_user(user_id));

create policy books_read   on public.books for select to authenticated using (my_role() is not null);
create policy books_insert on public.books for insert to authenticated with check (is_admin());
create policy books_update on public.books for update to authenticated using (is_admin()) with check (is_admin());

create policy inventory_read on public.inventory for select to authenticated using (can_view_user(user_id));
create policy movements_read on public.inventory_movements for select to authenticated
  using ((user_id is null and is_staff()) or (user_id is not null and can_view_user(user_id)));

create policy territories_read   on public.territories for select to authenticated using (my_role() is not null);
create policy territories_insert on public.territories for insert to authenticated with check (is_admin());
create policy territories_update on public.territories for update to authenticated using (is_admin()) with check (is_admin());

create policy customers_read   on public.customers for select to authenticated using (can_view_user(created_by));
create policy customers_insert on public.customers for insert to authenticated
  with check (created_by = auth.uid() and my_role() is not null);
create policy customers_update on public.customers for update to authenticated
  using (created_by = auth.uid() or can_manage_user(created_by))
  with check (created_by = auth.uid() or can_manage_user(created_by));

create policy tx_read       on public.transactions for select to authenticated using (can_view_user(user_id));
create policy items_read    on public.transaction_items for select to authenticated
  using (exists (select 1 from transactions t where t.id = transaction_id and can_view_user(t.user_id)));
create policy donations_read on public.donations for select to authenticated using (can_view_user(user_id));
create policy payments_read  on public.payments for select to authenticated using (can_view_user(user_id));

create policy recon_read on public.daily_reconciliations for select to authenticated using (can_view_user(student_id));

create policy followups_read on public.follow_ups for select to authenticated
  using (can_view_user(assigned_to) or created_by = auth.uid());
create policy followups_insert on public.follow_ups for insert to authenticated
  with check (created_by = auth.uid() and can_view_user(assigned_to)
              and exists (select 1 from customers c where c.id = customer_id and can_view_user(c.created_by)));
create policy followups_update on public.follow_ups for update to authenticated
  using (can_view_user(assigned_to)) with check (can_view_user(assigned_to));

create policy audit_admin on public.audit_log for select to authenticated using (is_admin());

-- ═════════════════════════ Grants ═════════════════════════
-- Belt and braces: even if a policy were added by mistake, the browser roles
-- simply have no write privilege on the sensitive tables.
revoke insert, update, delete on
  public.profiles, public.access_codes, public.access_code_redemptions, public.work_sessions,
  public.inventory, public.inventory_movements, public.transactions, public.transaction_items,
  public.donations, public.payments, public.daily_reconciliations, public.audit_log, public.teams
from anon, authenticated;
revoke insert, update, delete on public.app_settings, public.books, public.territories,
  public.customers, public.follow_ups from anon;
revoke delete on public.app_settings, public.books, public.territories, public.customers from authenticated;
revoke all on all tables in schema public from anon;
grant select on public.app_settings to anon;

-- Functions: nothing is callable by anonymous visitors except the code check.
revoke execute on all functions in schema public from public, anon;
grant execute on all functions in schema public to authenticated;
grant execute on function public.check_access_code(text) to anon;
-- Internal helpers the browser never needs to call directly
revoke execute on function public.handle_new_user() from authenticated;
revoke execute on function public.log_audit(text, text, uuid, jsonb, jsonb) from authenticated;
revoke execute on function public.audit_books() from authenticated;
revoke execute on function public.audit_generic() from authenticated;
alter default privileges in schema public revoke execute on functions from public, anon;
