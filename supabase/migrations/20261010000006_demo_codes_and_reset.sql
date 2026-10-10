-- YES Canvassing App — demo access codes and admin data reset
--
-- Demo codes only open the in-browser demo (a separate database that lives in the
-- visitor's browser). They never create an account and never touch real data.

create table public.demo_codes (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (code = upper(code) and length(code) between 6 and 40),
  label         text check (length(label) <= 120),
  created_by    uuid references public.profiles(id),
  created_at    timestamptz not null default now(),
  expires_at    timestamptz,
  max_uses      int check (max_uses is null or max_uses >= 1),   -- null = unlimited
  uses          int not null default 0 check (uses >= 0),
  active        boolean not null default true,
  last_used_at  timestamptz
);

alter table public.demo_codes enable row level security;
create policy demo_codes_admin on public.demo_codes for select to authenticated using (is_admin());
revoke insert, update, delete on public.demo_codes from anon, authenticated;
revoke all on public.demo_codes from anon;

-- Anyone may redeem a demo code; it only answers a status word.
create or replace function public.redeem_demo_code(p_code text) returns text
language plpgsql security definer set search_path = public as $$
declare d demo_codes;
begin
  select * into d from demo_codes where code = upper(trim(coalesce(p_code, ''))) for update;
  if not found or not d.active then return 'invalid'; end if;
  if d.expires_at is not null and d.expires_at < now() then return 'expired'; end if;
  if d.max_uses is not null and d.uses >= d.max_uses then return 'used'; end if;
  update demo_codes set uses = uses + 1, last_used_at = now() where id = d.id;
  return 'valid';
end $$;

create or replace function public.create_demo_code(p_label text default null, p_days int default 7, p_max_uses int default null)
returns demo_codes
language plpgsql security definer set search_path = public as $$
declare
  alphabet text := 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  bytes bytea; v_code text; d demo_codes; i int;
begin
  if not is_admin() then raise exception 'Only an admin can create demo codes.'; end if;
  if p_max_uses is not null and p_max_uses < 1 then raise exception 'Max uses must be at least 1.'; end if;
  loop
    bytes := uuid_send(gen_random_uuid());
    v_code := 'DEMO-';
    for i in 0..5 loop
      v_code := v_code || substr(alphabet, (get_byte(bytes, i) % length(alphabet)) + 1, 1);
    end loop;
    exit when not exists (select 1 from demo_codes where code = v_code);
  end loop;
  insert into demo_codes (code, label, created_by, expires_at, max_uses)
  values (v_code, nullif(trim(p_label), ''), auth.uid(),
          case when coalesce(p_days, 0) > 0 then now() + make_interval(days => p_days) end, p_max_uses)
  returning * into d;
  perform log_audit('Admin created demo code', 'demo_code', d.id, null, jsonb_build_object('label', d.label, 'expires_at', d.expires_at));
  return d;
end $$;

create or replace function public.set_demo_code_active(p_id uuid, p_active boolean) returns demo_codes
language plpgsql security definer set search_path = public as $$
declare d demo_codes;
begin
  if not is_admin() then raise exception 'Only an admin can change demo codes.'; end if;
  update demo_codes set active = p_active where id = p_id returning * into d;
  if d.id is null then raise exception 'Demo code not found.'; end if;
  perform log_audit(case when p_active then 'Admin activated demo code' else 'Admin revoked demo code' end, 'demo_code', d.id);
  return d;
end $$;

-- ───────── Reset operational data (admin) ─────────
-- Deletes all field activity and money records and sets every stock count to 0.
-- Keeps: users and roles, teams, the book catalog (names/prices), territories,
-- settings, access codes and the audit log (which records the reset itself).
create or replace function public.admin_reset_data(p_confirm text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  me profiles := require_active_me();
  c jsonb := '{}'::jsonb;
  n int;
begin
  if not is_admin() then raise exception 'Only an admin can reset data.'; end if;
  if coalesce(p_confirm, '') <> 'RESET' then raise exception 'Type RESET to confirm.'; end if;

  delete from work_session_events;      get diagnostics n = row_count; c := c || jsonb_build_object('work_events', n);
  delete from payments;                 get diagnostics n = row_count; c := c || jsonb_build_object('payments', n);
  delete from donations;                get diagnostics n = row_count; c := c || jsonb_build_object('donations', n);
  delete from transaction_items;        get diagnostics n = row_count; c := c || jsonb_build_object('transaction_items', n);
  delete from inventory_movements;      get diagnostics n = row_count; c := c || jsonb_build_object('inventory_movements', n);
  delete from daily_reconciliations;    get diagnostics n = row_count; c := c || jsonb_build_object('reconciliations', n);
  delete from follow_ups;               get diagnostics n = row_count; c := c || jsonb_build_object('follow_ups', n);
  delete from transactions;             get diagnostics n = row_count; c := c || jsonb_build_object('transactions', n);
  delete from customers;                get diagnostics n = row_count; c := c || jsonb_build_object('customers', n);
  delete from work_sessions;            get diagnostics n = row_count; c := c || jsonb_build_object('work_sessions', n);
  delete from inventory;                get diagnostics n = row_count; c := c || jsonb_build_object('student_inventory_rows', n);
  update books set warehouse_qty = 0 where warehouse_qty <> 0;
                                        get diagnostics n = row_count; c := c || jsonb_build_object('books_stock_zeroed', n);

  perform log_audit('Admin reset all operational data', 'system', null, null, c);
  return c;
end $$;

revoke execute on function public.redeem_demo_code(text) from public;
grant execute on function public.redeem_demo_code(text) to anon, authenticated;
revoke execute on function public.create_demo_code(text, int, int), public.set_demo_code_active(uuid, boolean),
  public.admin_reset_data(text) from public, anon;
grant execute on function public.create_demo_code(text, int, int), public.set_demo_code_active(uuid, boolean),
  public.admin_reset_data(text) to authenticated;
