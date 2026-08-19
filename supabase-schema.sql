-- DubRoom schema — run in the Supabase SQL editor.

create table profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  username text unique not null,
  created_at timestamptz default now()
);

create table clips (
  id uuid primary key default gen_random_uuid(),
  uploader_id uuid references profiles(id) on delete set null,
  title text not null,
  source_label text,
  video_path text not null,
  duration_seconds numeric,
  status text not null default 'processing'
    check (status in ('processing', 'published', 'blocked', 'failed')),
  moderation_reason text,
  created_at timestamptz default now()
);

create table clip_characters (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips(id) on delete cascade,
  name text not null,
  color text default '#f5c542'
);

create table clip_lines (
  id uuid primary key default gen_random_uuid(),
  clip_id uuid references clips(id) on delete cascade,
  character_id uuid references clip_characters(id) on delete cascade,
  line_index int not null,
  start_ms int not null,
  end_ms int not null,
  transcript text,
  order_in_clip int not null
);

create table lobbies (
  id uuid primary key default gen_random_uuid(),
  code text unique not null,
  clip_id uuid references clips(id),
  host_id uuid references profiles(id),
  status text not null default 'lobby'
    check (status in ('lobby', 'watching_intro', 'recording', 'mixing', 'playback', 'closed')),
  created_at timestamptz default now()
);

create table lobby_players (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid references lobbies(id) on delete cascade,
  user_id uuid references profiles(id),
  character_id uuid references clip_characters(id),
  joined_at timestamptz default now(),
  unique (lobby_id, character_id),
  unique (lobby_id, user_id)
);

create table recordings (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid references lobbies(id) on delete cascade,
  player_id uuid references lobby_players(id) on delete cascade,
  line_id uuid references clip_lines(id),
  audio_path text not null,
  take_number int not null default 1,
  created_at timestamptz default now()
);

create table mixes (
  id uuid primary key default gen_random_uuid(),
  lobby_id uuid references lobbies(id) on delete cascade,
  video_path text not null,
  created_at timestamptz default now()
);

alter table profiles enable row level security;
alter table clips enable row level security;
alter table clip_characters enable row level security;
alter table clip_lines enable row level security;
alter table lobbies enable row level security;
alter table lobby_players enable row level security;
alter table recordings enable row level security;
alter table mixes enable row level security;

create policy "logged in users can read profiles" on profiles
  for select using (auth.role() = 'authenticated');

create policy "logged in users can read published clips" on clips
  for select using (auth.role() = 'authenticated' and status = 'published');

create policy "uploader can read their own clip regardless of status" on clips
  for select using (auth.uid() = uploader_id);

create policy "logged in users can insert clips" on clips
  for insert with check (auth.uid() = uploader_id);

create policy "logged in users can read clip characters" on clip_characters
  for select using (auth.role() = 'authenticated');

create policy "logged in users can read clip lines" on clip_lines
  for select using (auth.role() = 'authenticated');

create policy "logged in users can read lobbies" on lobbies
  for select using (auth.role() = 'authenticated');

create policy "logged in users can create lobbies" on lobbies
  for insert with check (auth.uid() = host_id);

create policy "logged in users can read lobby players" on lobby_players
  for select using (auth.role() = 'authenticated');

create policy "logged in users can join lobbies" on lobby_players
  for insert with check (auth.uid() = user_id);

create policy "players can read recordings in their lobby" on recordings
  for select using (auth.role() = 'authenticated');

create policy "players can insert their own recordings" on recordings
  for insert with check (
    exists (
      select 1 from lobby_players lp
      where lp.id = player_id and lp.user_id = auth.uid()
    )
  );

create policy "logged in users can read mixes" on mixes
  for select using (auth.role() = 'authenticated');
