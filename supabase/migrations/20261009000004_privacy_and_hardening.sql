-- YES Canvassing App — privacy (Lebanon Law No. 81/2018, Part V) and input hardening
--
--  Art. 88  inform people at collection        → privacy notice + recorded acceptance at sign-up
--  Art. 90  retention period                    → settings.retention_years, shown in the notice
--  Art. 93  security of the data                → length limits below (+ RLS/RPCs from 0002)
--  Art. 94  (7) prior consent exempts the permit → privacy_accepted_at is the evidence
--  Art. 99  right to a copy of one's data       → export_my_data()
--  Art. 101 correction / erasure in 10 days      → admin_erase_customer(), admin_update_profile()

-- ───────── Settings: who is responsible and how to reach them ─────────
alter table public.app_settings
  add column if not exists data_controller text not null default 'YES — Youth Education Scholarship',
  add column if not exists privacy_contact  text,
  add column if not exists retention_years  int  not null default 5 check (retention_years between 1 and 20);

-- ───────── Consent evidence ─────────
alter table public.profiles add column if not exists privacy_accepted_at timestamptz;

-- ───────── Length limits: nobody can push megabytes of text (or payloads) into the database ─────────
alter table public.profiles
  add constraint profiles_len check (length(full_name) <= 120 and length(email) <= 254 and coalesce(length(phone), 0) <= 40);
alter table public.teams
  add constraint teams_len check (length(team_name) <= 80 and coalesce(length(notes), 0) <= 1000);
alter table public.access_codes
  add constraint access_codes_notes_len check (coalesce(length(notes), 0) <= 500);
alter table public.work_sessions
  add constraint work_sessions_len check (coalesce(length(notes), 0) <= 1000);
alter table public.books
  add constraint books_len check (length(code) <= 12 and coalesce(length(name), 0) <= 160 and coalesce(length(category), 0) <= 60
                                  and coalesce(length(language), 0) <= 40 and coalesce(length(image_url), 0) <= 500
                                  and (image_url is null or image_url ~ '^https://'));
alter table public.territories
  add constraint territories_len check (length(territory_name) <= 120 and coalesce(length(city), 0) <= 80
                                        and coalesce(length(area), 0) <= 80 and coalesce(length(notes), 0) <= 1000);
alter table public.customers
  add constraint customers_len check (coalesce(length(name), 0) <= 120 and coalesce(length(phone), 0) <= 40
                                      and coalesce(length(whatsapp), 0) <= 40 and coalesce(length(email), 0) <= 254
                                      and coalesce(length(city), 0) <= 80 and coalesce(length(neighborhood), 0) <= 80
                                      and coalesce(length(notes), 0) <= 1000);
alter table public.transactions
  add constraint transactions_len check (coalesce(length(city), 0) <= 80 and coalesce(length(neighborhood), 0) <= 80
                                         and coalesce(length(notes), 0) <= 1000 and coalesce(length(cancelled_reason), 0) <= 500);
alter table public.donations
  add constraint donations_len check (coalesce(length(donor_name), 0) <= 120 and coalesce(length(donor_email), 0) <= 254
                                      and coalesce(length(notes), 0) <= 1000);
alter table public.payments
  add constraint payments_len check (length(method) <= 20 and coalesce(length(reference), 0) <= 120);
alter table public.daily_reconciliations
  add constraint recon_len check (coalesce(length(notes), 0) <= 2000);
alter table public.follow_ups
  add constraint follow_ups_len check (length(follow_up_type) <= 40 and coalesce(length(outcome), 0) <= 1000
                                       and coalesce(length(notes), 0) <= 1000);
-- Money stays in a sane range (protects reports from typos like 1,000,000)
alter table public.transactions add constraint transactions_amount_range check (donation_amount <= 100000 and total_paid <= 100000);
alter table public.payments     add constraint payments_amount_range     check (amount <= 100000);
alter table public.donations    add constraint donations_amount_range    check (amount <= 100000);

-- ───────── Sign-up now requires accepting the privacy notice (Art. 88 / 94-7) ─────────
create or replace function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public as $$
declare
  v_code   text := upper(trim(coalesce(new.raw_user_meta_data->>'access_code', '')));
  v_row    access_codes;
  v_role   text := 'student';
  v_team   uuid;
  v_leader uuid;
  v_name   text := left(coalesce(nullif(trim(new.raw_user_meta_data->>'full_name'), ''), split_part(new.email, '@', 1)), 120);
  v_privacy timestamptz;
begin
  if coalesce(new.raw_app_meta_data->>'provisioned', '') = 'true' then
    v_role := coalesce(new.raw_app_meta_data->>'role', 'student');
    if v_role not in ('student','leader','admin') then v_role := 'student'; end if;
  else
    if coalesce(new.raw_user_meta_data->>'privacy_accepted', '') <> 'true' then
      raise exception 'Please read and accept the privacy notice to create an account.';
    end if;
    v_privacy := now();
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

  insert into profiles (id, full_name, email, phone, role, team_id, leader_id, privacy_accepted_at)
  values (new.id, v_name, new.email, left(nullif(trim(new.raw_user_meta_data->>'phone'), ''), 40), v_role, v_team, v_leader, v_privacy);

  if v_row.id is not null then
    update access_codes
       set current_uses = current_uses + 1, used_by = new.id, used_at = now()
     where id = v_row.id;
    insert into access_code_redemptions (access_code_id, user_id) values (v_row.id, new.id);
  end if;

  insert into audit_log (user_id, action, entity_type, entity_id, new_value)
  values (new.id,
          case when v_row.id is null then 'User provisioned by server' else 'User registered with access code' end,
          'profile', new.id, jsonb_build_object('role', v_role, 'code', v_row.code, 'privacy_accepted_at', v_privacy));
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

-- Existing users (created before this notice) record their acceptance from the app.
create or replace function public.accept_privacy() returns timestamptz
language plpgsql security definer set search_path = public as $$
declare me profiles := require_active_me(); v timestamptz := now();
begin
  update profiles set privacy_accepted_at = coalesce(privacy_accepted_at, v) where id = me.id returning privacy_accepted_at into v;
  return v;
end $$;

-- ───────── Art. 99: a person can get a full copy of their own data ─────────
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

-- ───────── Art. 101: erase a customer's personal data on request (sales totals stay intact) ─────────
create or replace function public.admin_erase_customer(p_id uuid, p_reason text) returns void
language plpgsql security definer set search_path = public as $$
declare c customers;
begin
  if not is_admin() then raise exception 'Only an admin can erase personal data.'; end if;
  if coalesce(trim(p_reason), '') = '' then raise exception 'Please record why (e.g. the person''s request and date).'; end if;
  select * into c from customers where id = p_id for update;
  if not found then raise exception 'Customer not found.'; end if;
  update customers
     set name = '[erased]', phone = null, whatsapp = null, email = null, notes = null, consent = false, consent_date = null
   where id = p_id;
  update follow_ups set notes = null, outcome = null where customer_id = p_id;
  update donations set donor_name = null, donor_email = null
   where transaction_id in (select id from transactions where customer_id = p_id);
  perform log_audit('Admin erased customer personal data', 'customer', p_id, null, jsonb_build_object('reason', trim(p_reason)));
end $$;

revoke execute on function public.accept_privacy() from public, anon;
revoke execute on function public.export_my_data() from public, anon;
revoke execute on function public.admin_erase_customer(uuid, text) from public, anon;
grant execute on function public.accept_privacy(), public.export_my_data(), public.admin_erase_customer(uuid, text) to authenticated;
