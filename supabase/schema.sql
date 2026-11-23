-- ============================================================
-- TRIPSPHERE — PostgreSQL / Supabase schema with Row Level Security
--
-- Alternative to the Cloudflare D1 schema in db/schema.sql.
-- Apply in the Supabase SQL editor (or `supabase db push`).
--
-- Ownership model:
--   * inventory tables are publicly readable, writable only by service role
--   * every personal row is owned by auth.uid() and protected by RLS
--   * storage bucket "travel-photos" is private, path-prefixed by user id
-- ============================================================

create extension if not exists "pgcrypto";

-- ------------------------------------------------------------
-- identity
-- ------------------------------------------------------------

create table if not exists public.users (
  id          uuid primary key references auth.users(id) on delete cascade,
  name        text not null,
  email       text not null unique,
  role        text not null default 'traveller',
  created_at  timestamptz not null default now()
);

create table if not exists public.user_profiles (
  user_id     uuid primary key references public.users(id) on delete cascade,
  bio         text,
  home_city   text,
  phone       text,
  avatar_tone text not null default 'clay',
  created_at  timestamptz not null default now()
);

create table if not exists public.user_preferences (
  user_id      uuid primary key references public.users(id) on delete cascade,
  interests    jsonb not null default '[]'::jsonb,
  budget_level text not null default 'mid',
  pace         text not null default 'balanced',
  transport    text not null default 'car',
  dietary      text,
  updated_at   timestamptz not null default now()
);

-- mirror new auth users into public.users
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.users (id, name, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'name', split_part(new.email, '@', 1)), new.email)
  on conflict (id) do nothing;
  insert into public.user_profiles (user_id) values (new.id) on conflict (user_id) do nothing;
  insert into public.user_preferences (user_id) values (new.id) on conflict (user_id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ------------------------------------------------------------
-- inventory (public read)
-- ------------------------------------------------------------

create table if not exists public.destinations (
  id               bigserial primary key,
  slug             text not null unique,
  name             text not null,
  state            text not null,
  region           text not null,
  tagline          text not null,
  summary          text not null,
  description      text not null,
  image            text not null,
  lat              double precision not null,
  lng              double precision not null,
  best_season      text not null,
  ideal_days       integer not null default 2,
  avg_daily_budget integer not null default 2500,
  interests        jsonb not null default '[]'::jsonb,
  is_hidden        boolean not null default false,
  popularity       integer not null default 50,
  unesco           boolean not null default false
);

create table if not exists public.attractions (
  id                bigserial primary key,
  slug              text not null unique,
  destination_id    bigint not null references public.destinations(id) on delete cascade,
  name              text not null,
  category          text not null,
  summary           text not null,
  description       text not null,
  image             text not null,
  lat               double precision not null,
  lng               double precision not null,
  opening_hours     text not null,
  entry_fee         integer not null default 0,
  avg_visit_minutes integer not null default 90,
  rating            numeric(2,1) not null default 4.2,
  reviews_count     integer not null default 120,
  is_hidden         boolean not null default false,
  unesco            boolean not null default false,
  tips              text
);

create table if not exists public.hotels (
  id              bigserial primary key,
  slug            text not null unique,
  destination_id  bigint not null references public.destinations(id) on delete cascade,
  name            text not null,
  type            text not null default 'hotel',
  summary         text not null,
  description     text not null,
  image           text not null,
  lat             double precision not null,
  lng             double precision not null,
  address         text not null,
  price_per_night integer not null check (price_per_night >= 0),
  rating          numeric(2,1) not null default 4.1,
  reviews_count   integer not null default 80,
  amenities       jsonb not null default '[]'::jsonb,
  check_in_time   text not null default '14:00',
  check_out_time  text not null default '11:00',
  rooms_total     integer not null default 20,
  booking_url     text
);

create table if not exists public.restaurants (
  id              bigserial primary key,
  slug            text not null unique,
  destination_id  bigint not null references public.destinations(id) on delete cascade,
  name            text not null,
  cuisine         text not null,
  summary         text not null,
  description     text not null,
  image           text not null,
  lat             double precision not null,
  lng             double precision not null,
  address         text not null,
  price_for_two   integer not null check (price_for_two >= 0),
  rating          numeric(2,1) not null default 4.1,
  reviews_count   integer not null default 60,
  opening_hours   text not null,
  opens_at        text not null default '11:00',
  closes_at       text not null default '23:00',
  menu_summary     text,
  reservation_url  text
);

create table if not exists public.guides (
  id             bigserial primary key,
  slug           text not null unique,
  title          text not null,
  excerpt        text not null,
  body           text not null,
  image          text not null,
  destination_id bigint references public.destinations(id) on delete set null,
  category       text not null default 'field-notes',
  read_minutes   integer not null default 5,
  author         text not null default 'TRIPSPHERE Editorial'
);

-- ------------------------------------------------------------
-- personal data (owner only)
-- ------------------------------------------------------------

create table if not exists public.itineraries (
  id             bigserial primary key,
  user_id        uuid not null references public.users(id) on delete cascade,
  title          text not null,
  origin         text,
  destination_id bigint references public.destinations(id) on delete set null,
  start_date     date,
  end_date       date,
  travellers     integer not null default 2 check (travellers between 1 and 20),
  budget         integer not null default 20000 check (budget >= 0),
  transport      text not null default 'car',
  interests      jsonb not null default '[]'::jsonb,
  pace           text not null default 'balanced',
  status         text not null default 'planned' check (status in ('planned','ongoing','completed')),
  summary        text,
  ai_mode        text not null default 'smart-engine',
  share_token    text unique,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create table if not exists public.itinerary_items (
  id               bigserial primary key,
  itinerary_id     bigint not null references public.itineraries(id) on delete cascade,
  day              integer not null default 1 check (day between 1 and 14),
  slot             text not null default 'morning',
  time             text,
  title            text not null,
  place_type       text not null default 'custom',
  place_id         bigint,
  notes            text,
  duration_minutes integer not null default 90 check (duration_minutes between 15 and 600),
  cost             integer not null default 0 check (cost >= 0),
  lat              double precision,
  lng              double precision,
  sort_order       integer not null default 0
);

create table if not exists public.hotel_bookings (
  id           bigserial primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  hotel_id     bigint not null references public.hotels(id) on delete cascade,
  reference    text not null unique,
  check_in     date not null,
  check_out    date not null,
  guests       integer not null default 2 check (guests between 1 and 12),
  rooms        integer not null default 1 check (rooms between 1 and 6),
  nights       integer not null default 1 check (nights > 0),
  total_amount integer not null default 0,
  status       text not null default 'requested' check (status in ('requested','confirmed','cancelled')),
  mode         text not null default 'demo',
  note         text,
  created_at   timestamptz not null default now(),
  constraint valid_dates check (check_out > check_in)
);

create table if not exists public.restaurant_reservations (
  id            bigserial primary key,
  user_id       uuid not null references public.users(id) on delete cascade,
  restaurant_id bigint not null references public.restaurants(id) on delete cascade,
  reference     text not null unique,
  date          date not null,
  time          text not null,
  guests        integer not null default 2 check (guests between 1 and 12),
  status        text not null default 'requested' check (status in ('requested','confirmed','cancelled')),
  mode          text not null default 'demo',
  note          text,
  created_at    timestamptz not null default now()
);

create table if not exists public.saved_places (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  place_type text not null check (place_type in ('destination','attraction','hotel','restaurant','guide')),
  place_id   bigint not null,
  created_at timestamptz not null default now(),
  unique (user_id, place_type, place_id)
);

create table if not exists public.travel_expenses (
  id           bigserial primary key,
  user_id      uuid not null references public.users(id) on delete cascade,
  itinerary_id bigint references public.itineraries(id) on delete set null,
  category     text not null check (category in ('accommodation','food','transport','activities','other')),
  label        text not null,
  amount       integer not null check (amount > 0),
  spent_on     date not null default current_date,
  created_at   timestamptz not null default now()
);

create table if not exists public.heritage_passport (
  id             bigserial primary key,
  user_id        uuid not null references public.users(id) on delete cascade,
  destination_id bigint not null references public.destinations(id) on delete cascade,
  attraction_id  bigint references public.attractions(id) on delete set null,
  visited_on     date not null,
  notes          text,
  rating         integer check (rating between 1 and 5),
  created_at     timestamptz not null default now()
);

create table if not exists public.travel_photos (
  id             bigserial primary key,
  user_id        uuid not null references public.users(id) on delete cascade,
  itinerary_id   bigint references public.itineraries(id) on delete set null,
  destination_id bigint references public.destinations(id) on delete set null,
  caption        text,
  object_key     text not null,
  content_type   text not null default 'image/jpeg',
  created_at     timestamptz not null default now()
);

create table if not exists public.notifications (
  id         bigserial primary key,
  user_id    uuid not null references public.users(id) on delete cascade,
  title      text not null,
  body       text not null,
  kind       text not null default 'info',
  link       text,
  read       boolean not null default false,
  created_at timestamptz not null default now()
);

-- ------------------------------------------------------------
-- indexes
-- ------------------------------------------------------------

create index if not exists idx_attractions_destination on public.attractions(destination_id);
create index if not exists idx_hotels_destination on public.hotels(destination_id);
create index if not exists idx_restaurants_destination on public.restaurants(destination_id);
create index if not exists idx_destinations_hidden on public.destinations(is_hidden);
create index if not exists idx_places_geo on public.attractions(lat, lng);
create index if not exists idx_itineraries_user on public.itineraries(user_id);
create index if not exists idx_itinerary_items_trip on public.itinerary_items(itinerary_id);
create index if not exists idx_bookings_user on public.hotel_bookings(user_id);
create index if not exists idx_reservations_user on public.restaurant_reservations(user_id);
create index if not exists idx_saved_user on public.saved_places(user_id);
create index if not exists idx_expenses_user on public.travel_expenses(user_id);
create index if not exists idx_passport_user on public.heritage_passport(user_id);
create index if not exists idx_photos_user on public.travel_photos(user_id);
create index if not exists idx_notifications_user on public.notifications(user_id, read);

-- ------------------------------------------------------------
-- updated_at trigger
-- ------------------------------------------------------------

create or replace function public.touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists trg_itineraries_touch on public.itineraries;
create trigger trg_itineraries_touch before update on public.itineraries
  for each row execute function public.touch_updated_at();

-- ------------------------------------------------------------
-- Row Level Security
-- ------------------------------------------------------------

alter table public.users                  enable row level security;
alter table public.user_profiles          enable row level security;
alter table public.user_preferences       enable row level security;
alter table public.destinations           enable row level security;
alter table public.attractions            enable row level security;
alter table public.hotels                 enable row level security;
alter table public.restaurants            enable row level security;
alter table public.guides                 enable row level security;
alter table public.itineraries            enable row level security;
alter table public.itinerary_items        enable row level security;
alter table public.hotel_bookings         enable row level security;
alter table public.restaurant_reservations enable row level security;
alter table public.saved_places           enable row level security;
alter table public.travel_expenses        enable row level security;
alter table public.heritage_passport      enable row level security;
alter table public.travel_photos          enable row level security;
alter table public.notifications          enable row level security;

-- inventory: anyone can read
create policy "inventory read" on public.destinations for select using (true);
create policy "inventory read" on public.attractions for select using (true);
create policy "inventory read" on public.hotels for select using (true);
create policy "inventory read" on public.restaurants for select using (true);
create policy "inventory read" on public.guides for select using (true);

-- identity
create policy "own user read"   on public.users for select using (id = auth.uid());
create policy "own user update" on public.users for update using (id = auth.uid()) with check (id = auth.uid());

create policy "own profile" on public.user_profiles
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own preferences" on public.user_preferences
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- itineraries: owners, plus public read of shared itineraries
create policy "itinerary owner" on public.itineraries
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "itinerary shared read" on public.itineraries
  for select using (share_token is not null);

create policy "itinerary item owner" on public.itinerary_items
  for all
  using (exists (select 1 from public.itineraries i where i.id = itinerary_id and i.user_id = auth.uid()))
  with check (exists (select 1 from public.itineraries i where i.id = itinerary_id and i.user_id = auth.uid()));
create policy "itinerary item shared read" on public.itinerary_items
  for select using (exists (select 1 from public.itineraries i where i.id = itinerary_id and i.share_token is not null));

create policy "own bookings" on public.hotel_bookings
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own reservations" on public.restaurant_reservations
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own saved" on public.saved_places
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own expenses" on public.travel_expenses
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own passport" on public.heritage_passport
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own photos" on public.travel_photos
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "own notifications" on public.notifications
  for all using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ------------------------------------------------------------
-- storage: private bucket for travel photos
-- ------------------------------------------------------------

insert into storage.buckets (id, name, public)
values ('travel-photos', 'travel-photos', false)
on conflict (id) do nothing;

create policy "photo upload" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'travel-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo read" on storage.objects
  for select to authenticated
  using (bucket_id = 'travel-photos' and (storage.foldername(name))[1] = auth.uid()::text);

create policy "photo delete" on storage.objects
  for delete to authenticated
  using (bucket_id = 'travel-photos' and (storage.foldername(name))[1] = auth.uid()::text);
