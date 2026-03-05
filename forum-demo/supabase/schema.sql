-- Forumline Demo - Supabase Schema
-- Run this in your Supabase SQL Editor: https://supabase.com/dashboard/project/_/sql

-- Enable required extensions
create extension if not exists "uuid-ossp";

-- ============================================
-- PROFILES TABLE
-- Extends Supabase auth.users with profile info
-- ============================================
create table public.profiles (
  id uuid references auth.users on delete cascade primary key,
  username text unique not null,
  display_name text,
  avatar_url text,
  bio text,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,

  constraint username_length check (char_length(username) >= 3 and char_length(username) <= 30),
  constraint username_format check (username ~ '^[a-zA-Z0-9_]+$')
);

-- Index for username lookups
create index profiles_username_idx on public.profiles (username);

-- Enable RLS
alter table public.profiles enable row level security;

-- Policies
create policy "Public profiles are viewable by everyone"
  on public.profiles for select
  using (true);

create policy "Users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

create policy "Users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ============================================
-- CATEGORIES TABLE
-- Forum categories/boards
-- ============================================
create table public.categories (
  id uuid default uuid_generate_v4() primary key,
  name text not null,
  slug text unique not null,
  description text,
  sort_order integer default 0,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null
);

-- Index for slug lookups
create index categories_slug_idx on public.categories (slug);

-- Enable RLS
alter table public.categories enable row level security;

-- Policies (categories are public read, admin write)
create policy "Categories are viewable by everyone"
  on public.categories for select
  using (true);

-- ============================================
-- THREADS TABLE
-- Forum discussion threads
-- ============================================
create table public.threads (
  id uuid default uuid_generate_v4() primary key,
  category_id uuid references public.categories on delete cascade not null,
  author_id uuid references public.profiles on delete cascade not null,
  title text not null,
  slug text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  image_url text,
  is_pinned boolean default false,
  is_locked boolean default false,
  post_count integer default 0,
  last_post_at timestamp with time zone,

  constraint title_length check (char_length(title) >= 5 and char_length(title) <= 200)
);

-- Indexes
create index threads_category_id_idx on public.threads (category_id);
create index threads_author_id_idx on public.threads (author_id);
create index threads_created_at_idx on public.threads (created_at desc);
create index threads_last_post_at_idx on public.threads (last_post_at desc nulls last);

-- Enable RLS
alter table public.threads enable row level security;

-- Policies
create policy "Threads are viewable by everyone"
  on public.threads for select
  using (true);

create policy "Authenticated users can create threads"
  on public.threads for insert
  with check (auth.uid() = author_id);

create policy "Authors can update their own threads"
  on public.threads for update
  using (auth.uid() = author_id);

-- ============================================
-- POSTS TABLE
-- Individual posts/replies in threads
-- ============================================
create table public.posts (
  id uuid default uuid_generate_v4() primary key,
  thread_id uuid references public.threads on delete cascade not null,
  author_id uuid references public.profiles on delete cascade not null,
  content text not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,
  updated_at timestamp with time zone default timezone('utc'::text, now()) not null,
  reply_to_id uuid references public.posts on delete set null,

  constraint content_length check (char_length(content) >= 1 and char_length(content) <= 50000)
);

-- Indexes
create index posts_thread_id_idx on public.posts (thread_id);
create index posts_author_id_idx on public.posts (author_id);
create index posts_created_at_idx on public.posts (created_at);

-- Enable RLS
alter table public.posts enable row level security;

-- Policies
create policy "Posts are viewable by everyone"
  on public.posts for select
  using (true);

create policy "Authenticated users can create posts"
  on public.posts for insert
  with check (
    auth.uid() = author_id
    and not exists (
      select 1 from public.threads
      where threads.id = thread_id
      and threads.is_locked = true
    )
  );

create policy "Authors can update their own posts"
  on public.posts for update
  using (auth.uid() = author_id);

-- ============================================
-- FUNCTIONS & TRIGGERS
-- ============================================

-- Function to handle new user creation
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, username, display_name)
  values (
    new.id,
    coalesce(new.raw_user_meta_data->>'username', 'user_' || substr(new.id::text, 1, 8)),
    coalesce(new.raw_user_meta_data->>'username', new.email)
  );
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for new user creation
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Function to update thread stats when a post is created
create or replace function public.update_thread_on_post()
returns trigger as $$
begin
  update public.threads
  set
    post_count = post_count + 1,
    last_post_at = new.created_at,
    updated_at = new.created_at
  where id = new.thread_id;
  return new;
end;
$$ language plpgsql security definer;

-- Trigger for post creation
create trigger on_post_created
  after insert on public.posts
  for each row execute procedure public.update_thread_on_post();

-- ============================================
-- SEED DATA
-- Default categories to get started
-- ============================================
insert into public.categories (name, slug, description, sort_order) values
  ('General', 'general', 'General discussion about anything and everything', 0),
  ('Announcements', 'announcements', 'Official announcements from the team', 1),
  ('Help & Support', 'help', 'Get help from the community', 2),
  ('Showcase', 'showcase', 'Show off your projects and creations', 3),
  ('Feedback', 'feedback', 'Share your feedback and suggestions', 4);

-- ============================================
-- DIRECT MESSAGES TABLE
-- Private messages between users
-- ============================================
create table public.direct_messages (
  id uuid default uuid_generate_v4() primary key,
  sender_id uuid references public.profiles on delete cascade not null,
  recipient_id uuid references public.profiles on delete cascade not null,
  content text not null,
  read boolean default false not null,
  created_at timestamp with time zone default timezone('utc'::text, now()) not null,

  constraint content_not_empty check (char_length(content) >= 1 and char_length(content) <= 10000),
  constraint no_self_message check (sender_id <> recipient_id)
);

-- Indexes
create index dm_sender_id_idx on public.direct_messages (sender_id);
create index dm_recipient_id_idx on public.direct_messages (recipient_id);
create index dm_created_at_idx on public.direct_messages (created_at desc);
create index dm_conversation_idx on public.direct_messages (
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at desc
);
create index dm_unread_idx on public.direct_messages (recipient_id, read)
  where read = false;

-- Enable RLS
alter table public.direct_messages enable row level security;

-- Policies
create policy "Users can view their own DMs"
  on public.direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

create policy "Authenticated users can send DMs"
  on public.direct_messages for insert
  with check (auth.uid() = sender_id);

create policy "Recipients can mark DMs as read"
  on public.direct_messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- ============================================
-- REALTIME
-- Enable realtime for posts and direct_messages
-- ============================================
alter publication supabase_realtime add table public.posts;
alter publication supabase_realtime add table public.direct_messages;
