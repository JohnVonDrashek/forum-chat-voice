-- Voice Presence Table Migration
-- Tracks which users are currently in which voice rooms
-- Uses Supabase Realtime for instant updates instead of polling

-- ============================================
-- VOICE_PRESENCE TABLE
-- Tracks active voice room participants
-- ============================================
create table public.voice_presence (
  id uuid default uuid_generate_v4() primary key,
  user_id uuid references public.profiles on delete cascade not null,
  room_slug text not null,
  joined_at timestamp with time zone default timezone('utc'::text, now()) not null,

  -- Each user can only be in one room at a time
  constraint one_room_per_user unique (user_id)
);

-- Indexes
create index voice_presence_room_slug_idx on public.voice_presence (room_slug);
create index voice_presence_user_id_idx on public.voice_presence (user_id);

-- Enable RLS
alter table public.voice_presence enable row level security;

-- Policies
create policy "Voice presence is viewable by everyone"
  on public.voice_presence for select
  using (true);

create policy "Users can insert their own presence"
  on public.voice_presence for insert
  with check (auth.uid() = user_id);

create policy "Users can update their own presence"
  on public.voice_presence for update
  using (auth.uid() = user_id);

create policy "Users can delete their own presence"
  on public.voice_presence for delete
  using (auth.uid() = user_id);

-- Enable Realtime
alter publication supabase_realtime add table public.voice_presence;
