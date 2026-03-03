-- Hub Direct Messages Migration
-- Run on hub Supabase project (dptamxaerujopfzoazxq)

-- Create hub_direct_messages table
create table if not exists hub_direct_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid not null references hub_profiles(id) on delete cascade,
  recipient_id uuid not null references hub_profiles(id) on delete cascade,
  content text not null,
  read boolean not null default false,
  created_at timestamptz not null default now(),
  constraint sender_not_recipient check (sender_id != recipient_id)
);

-- Indexes
create index idx_hub_dms_sender on hub_direct_messages(sender_id);
create index idx_hub_dms_recipient on hub_direct_messages(recipient_id);
create index idx_hub_dms_conversation on hub_direct_messages(
  least(sender_id, recipient_id),
  greatest(sender_id, recipient_id),
  created_at desc
);
create index idx_hub_dms_unread on hub_direct_messages(recipient_id, read)
  where read = false;

-- Enable RLS
alter table hub_direct_messages enable row level security;

-- RLS policies
-- Users can read their own sent or received messages
create policy "Users can read own messages"
  on hub_direct_messages for select
  using (auth.uid() = sender_id or auth.uid() = recipient_id);

-- Users can insert messages they send
create policy "Users can send messages"
  on hub_direct_messages for insert
  with check (auth.uid() = sender_id);

-- Recipients can mark messages as read
create policy "Recipients can mark messages read"
  on hub_direct_messages for update
  using (auth.uid() = recipient_id)
  with check (auth.uid() = recipient_id);

-- Enable Supabase Realtime
alter publication supabase_realtime add table hub_direct_messages;
