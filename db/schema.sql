-- ============================================================
-- TRIPSPHERE — database schema (Cloudflare D1 / SQLite dialect)
-- A PostgreSQL/Supabase version with Row Level Security lives in
-- supabase/schema.sql.
-- ============================================================

PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  email         TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  role          TEXT    NOT NULL DEFAULT 'traveller',
  created_at    TEXT    NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_profiles (
  user_id     INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  bio         TEXT,
  home_city   TEXT,
  phone       TEXT,
  avatar_tone TEXT NOT NULL DEFAULT 'clay',
  created_at  TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS user_preferences (
  user_id      INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  interests    TEXT NOT NULL DEFAULT '[]',
  budget_level TEXT NOT NULL DEFAULT 'mid',
  pace         TEXT NOT NULL DEFAULT 'balanced',
  transport    TEXT NOT NULL DEFAULT 'car',
  dietary      TEXT,
  updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS destinations (
  id               INTEGER PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,
  name             TEXT NOT NULL,
  state            TEXT NOT NULL,
  region           TEXT NOT NULL,
  tagline          TEXT NOT NULL,
  summary          TEXT NOT NULL,
  description      TEXT NOT NULL,
  image            TEXT NOT NULL,
  lat              REAL NOT NULL,
  lng              REAL NOT NULL,
  best_season      TEXT NOT NULL,
  ideal_days       INTEGER NOT NULL DEFAULT 2,
  avg_daily_budget INTEGER NOT NULL DEFAULT 2500,
  interests        TEXT NOT NULL DEFAULT '[]',
  is_hidden        INTEGER NOT NULL DEFAULT 0,
  popularity       INTEGER NOT NULL DEFAULT 50,
  unesco           INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS attractions (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  slug              TEXT NOT NULL UNIQUE,
  destination_id    INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  name              TEXT NOT NULL,
  category          TEXT NOT NULL,
  summary           TEXT NOT NULL,
  description       TEXT NOT NULL,
  image             TEXT NOT NULL,
  lat               REAL NOT NULL,
  lng               REAL NOT NULL,
  opening_hours     TEXT NOT NULL,
  entry_fee         INTEGER NOT NULL DEFAULT 0,
  avg_visit_minutes INTEGER NOT NULL DEFAULT 90,
  rating            REAL NOT NULL DEFAULT 4.2,
  reviews_count     INTEGER NOT NULL DEFAULT 120,
  is_hidden         INTEGER NOT NULL DEFAULT 0,
  unesco            INTEGER NOT NULL DEFAULT 0,
  tips              TEXT
);

CREATE TABLE IF NOT EXISTS hotels (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  slug            TEXT NOT NULL UNIQUE,
  destination_id  INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  type            TEXT NOT NULL DEFAULT 'hotel',
  summary         TEXT NOT NULL,
  description     TEXT NOT NULL,
  image           TEXT NOT NULL,
  lat             REAL NOT NULL,
  lng             REAL NOT NULL,
  address         TEXT NOT NULL,
  price_per_night INTEGER NOT NULL,
  rating          REAL NOT NULL DEFAULT 4.1,
  reviews_count   INTEGER NOT NULL DEFAULT 80,
  amenities       TEXT NOT NULL DEFAULT '[]',
  check_in_time   TEXT NOT NULL DEFAULT '14:00',
  check_out_time  TEXT NOT NULL DEFAULT '11:00',
  rooms_total     INTEGER NOT NULL DEFAULT 20,
  booking_url     TEXT
);

CREATE TABLE IF NOT EXISTS restaurants (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  name           TEXT NOT NULL,
  cuisine        TEXT NOT NULL,
  summary        TEXT NOT NULL,
  description    TEXT NOT NULL,
  image          TEXT NOT NULL,
  lat            REAL NOT NULL,
  lng            REAL NOT NULL,
  address        TEXT NOT NULL,
  price_for_two  INTEGER NOT NULL,
  rating         REAL NOT NULL DEFAULT 4.1,
  reviews_count  INTEGER NOT NULL DEFAULT 60,
  opening_hours  TEXT NOT NULL,
  opens_at       TEXT NOT NULL DEFAULT '11:00',
  closes_at      TEXT NOT NULL DEFAULT '23:00',
  menu_summary   TEXT,
  reservation_url TEXT
);

CREATE TABLE IF NOT EXISTS itineraries (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title          TEXT NOT NULL,
  origin         TEXT,
  destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  start_date     TEXT,
  end_date       TEXT,
  travellers     INTEGER NOT NULL DEFAULT 2,
  budget         INTEGER NOT NULL DEFAULT 20000,
  transport      TEXT NOT NULL DEFAULT 'car',
  interests      TEXT NOT NULL DEFAULT '[]',
  pace           TEXT NOT NULL DEFAULT 'balanced',
  status         TEXT NOT NULL DEFAULT 'planned',
  summary        TEXT,
  ai_mode        TEXT NOT NULL DEFAULT 'smart-engine',
  share_token    TEXT UNIQUE,
  created_at     TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS itinerary_items (
  id               INTEGER PRIMARY KEY AUTOINCREMENT,
  itinerary_id     INTEGER NOT NULL REFERENCES itineraries(id) ON DELETE CASCADE,
  day              INTEGER NOT NULL DEFAULT 1,
  slot             TEXT NOT NULL DEFAULT 'morning',
  time             TEXT,
  title            TEXT NOT NULL,
  place_type       TEXT NOT NULL DEFAULT 'custom',
  place_id         INTEGER,
  notes            TEXT,
  duration_minutes INTEGER NOT NULL DEFAULT 90,
  cost             INTEGER NOT NULL DEFAULT 0,
  lat              REAL,
  lng              REAL,
  sort_order       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS hotel_bookings (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  hotel_id     INTEGER NOT NULL REFERENCES hotels(id) ON DELETE CASCADE,
  reference    TEXT NOT NULL UNIQUE,
  check_in     TEXT NOT NULL,
  check_out    TEXT NOT NULL,
  guests       INTEGER NOT NULL DEFAULT 2,
  rooms        INTEGER NOT NULL DEFAULT 1,
  nights       INTEGER NOT NULL DEFAULT 1,
  total_amount INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT 'requested',
  mode         TEXT NOT NULL DEFAULT 'demo',
  note         TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS restaurant_reservations (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  restaurant_id INTEGER NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  reference     TEXT NOT NULL UNIQUE,
  date          TEXT NOT NULL,
  time          TEXT NOT NULL,
  guests        INTEGER NOT NULL DEFAULT 2,
  status        TEXT NOT NULL DEFAULT 'requested',
  mode          TEXT NOT NULL DEFAULT 'demo',
  note          TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS saved_places (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place_type TEXT NOT NULL,
  place_id   INTEGER NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (user_id, place_type, place_id)
);

CREATE TABLE IF NOT EXISTS travel_expenses (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  itinerary_id INTEGER REFERENCES itineraries(id) ON DELETE SET NULL,
  category     TEXT NOT NULL,
  label        TEXT NOT NULL,
  amount       INTEGER NOT NULL,
  spent_on     TEXT NOT NULL DEFAULT (date('now')),
  created_at   TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS heritage_passport (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  destination_id INTEGER NOT NULL REFERENCES destinations(id) ON DELETE CASCADE,
  attraction_id  INTEGER REFERENCES attractions(id) ON DELETE SET NULL,
  visited_on     TEXT NOT NULL,
  notes          TEXT,
  rating         INTEGER,
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS travel_photos (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  itinerary_id   INTEGER REFERENCES itineraries(id) ON DELETE SET NULL,
  destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  caption        TEXT,
  object_key     TEXT NOT NULL,
  content_type   TEXT NOT NULL DEFAULT 'image/jpeg',
  created_at     TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL,
  kind       TEXT NOT NULL DEFAULT 'info',
  link       TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS guides (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  slug           TEXT NOT NULL UNIQUE,
  title          TEXT NOT NULL,
  excerpt        TEXT NOT NULL,
  body           TEXT NOT NULL,
  image          TEXT NOT NULL,
  destination_id INTEGER REFERENCES destinations(id) ON DELETE SET NULL,
  category       TEXT NOT NULL DEFAULT 'field-notes',
  read_minutes   INTEGER NOT NULL DEFAULT 5,
  author         TEXT NOT NULL DEFAULT 'TRIPSPHERE Editorial'
);

CREATE INDEX IF NOT EXISTS idx_attractions_destination ON attractions(destination_id);
CREATE INDEX IF NOT EXISTS idx_hotels_destination ON hotels(destination_id);
CREATE INDEX IF NOT EXISTS idx_restaurants_destination ON restaurants(destination_id);
CREATE INDEX IF NOT EXISTS idx_itineraries_user ON itineraries(user_id);
CREATE INDEX IF NOT EXISTS idx_itinerary_items_trip ON itinerary_items(itinerary_id);
CREATE INDEX IF NOT EXISTS idx_hotel_bookings_user ON hotel_bookings(user_id);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON restaurant_reservations(user_id);
CREATE INDEX IF NOT EXISTS idx_saved_user ON saved_places(user_id);
CREATE INDEX IF NOT EXISTS idx_expenses_user ON travel_expenses(user_id);
CREATE INDEX IF NOT EXISTS idx_passport_user ON heritage_passport(user_id);
CREATE INDEX IF NOT EXISTS idx_photos_user ON travel_photos(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_destinations_hidden ON destinations(is_hidden);
CREATE INDEX IF NOT EXISTS idx_places_lat_lng ON attractions(lat, lng);
