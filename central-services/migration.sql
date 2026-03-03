-- ============================================================================
-- Forumline Central Services — Database Migration
-- Run on the hub Supabase project (dptamxaerujopfzoazxq)
-- ============================================================================

-- Hub user profiles (extends Supabase Auth users)
create table hub_profiles (
  id uuid primary key references auth.users on delete cascade,
  username text unique not null,
  display_name text not null,
  avatar_url text,
  bio text,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table hub_profiles enable row level security;

create policy "Public profiles are viewable by everyone"
  on hub_profiles for select using (true);

create policy "Users can update own profile"
  on hub_profiles for update using (auth.uid() = id);

create policy "Users can insert own profile"
  on hub_profiles for insert with check (auth.uid() = id);

-- Forum registry
create table forumline_forums (
  id uuid primary key default gen_random_uuid(),
  domain text unique not null,
  name text not null,
  icon_url text,
  api_base text not null,
  web_base text not null,
  capabilities text[] default '{}',
  description text,
  owner_id uuid references hub_profiles(id),
  approved boolean default false not null,
  created_at timestamptz default now() not null,
  updated_at timestamptz default now() not null
);

alter table forumline_forums enable row level security;

create policy "Approved forums are viewable by everyone"
  on forumline_forums for select using (approved = true);

create policy "Owners can view own forums"
  on forumline_forums for select using (auth.uid() = owner_id);

create policy "Authenticated users can register forums"
  on forumline_forums for insert with check (auth.uid() = owner_id);

create policy "Owners can update own forums"
  on forumline_forums for update using (auth.uid() = owner_id);

-- User forum memberships
create table forumline_memberships (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references hub_profiles(id) on delete cascade,
  forum_id uuid not null references forumline_forums(id) on delete cascade,
  joined_at timestamptz default now() not null,
  unique(user_id, forum_id)
);

alter table forumline_memberships enable row level security;

create policy "Users can view own memberships"
  on forumline_memberships for select using (auth.uid() = user_id);

create policy "Users can insert own memberships"
  on forumline_memberships for insert with check (auth.uid() = user_id);

create policy "Users can delete own memberships"
  on forumline_memberships for delete using (auth.uid() = user_id);

-- OAuth clients (forum credentials for OAuth flow)
create table forumline_oauth_clients (
  id uuid primary key default gen_random_uuid(),
  forum_id uuid not null references forumline_forums(id) on delete cascade,
  client_id text unique not null,
  client_secret_hash text not null,
  redirect_uris text[] not null default '{}',
  created_at timestamptz default now() not null
);

alter table forumline_oauth_clients enable row level security;

-- OAuth clients are only accessed server-side via service role key
-- No RLS policies needed for client access

-- Ephemeral authorization codes (5-min TTL)
create table forumline_auth_codes (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  user_id uuid not null references hub_profiles(id) on delete cascade,
  forum_id uuid not null references forumline_forums(id) on delete cascade,
  redirect_uri text not null,
  expires_at timestamptz not null,
  used boolean default false not null,
  created_at timestamptz default now() not null
);

alter table forumline_auth_codes enable row level security;

-- Auth codes are only accessed server-side via service role key

-- Auto-update updated_at timestamps
create or replace function update_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

create trigger hub_profiles_updated_at
  before update on hub_profiles
  for each row execute function update_updated_at();

create trigger forumline_forums_updated_at
  before update on forumline_forums
  for each row execute function update_updated_at();

-- Auto-create hub profile on signup
create or replace function handle_new_hub_user()
returns trigger as $$
begin
  insert into hub_profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'username', 'New User')
  );
  return new;
end;
$$ language plpgsql security definer;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function handle_new_hub_user();

-- ============================================================================
-- Seed Data: Register forum-chat-voice as first approved forum
-- ============================================================================
-- We need to insert without owner_id since no hub user exists yet.
-- The RLS policy for insert requires auth.uid() = owner_id, but we're using
-- service role for migration so RLS is bypassed.

insert into forumline_forums (domain, name, api_base, web_base, capabilities, description, approved)
values (
  'forum-chat-voice.vercel.app',
  'Forum Chat Voice',
  'https://forum-chat-voice.vercel.app/api/forumline',
  'https://forum-chat-voice.vercel.app',
  '{"threads", "voice", "notifications"}',
  'Reference Forumline forum with real-time chat and voice rooms',
  true
);
