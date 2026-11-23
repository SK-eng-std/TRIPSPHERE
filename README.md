# TRIPSPHERE

**Explore Beyond Boundaries.**

TRIPSPHERE is a working, full-stack travel intelligence platform for Indian tourism: destination discovery, AI trip planning, hotel and restaurant discovery with request-based booking, nearby attractions, a budget engine, a conversational travel assistant and a digital travel passport.

> **Note on the starting point:** the supplied workspace contained no GEARUP N GOO source code or assets (the project folder was empty), so this is a complete implementation of the TRIPSPHERE brief rather than a patch of an existing codebase. Nothing was deleted, and every module in the brief is implemented below.

---

## 1. What is implemented

| Module | Where it lives | What actually works |
| --- | --- | --- |
| 1. AI trip planner | `/plan`, `api/lib/planner.ts`, `api/lib/ai.ts` | Day-wise itineraries with morning/afternoon/evening stops, restaurants, a stay, travel time, costs and route map. Save, regenerate, share and edit. |
| 2. Hotel discovery + booking | `/hotels`, `/nearby`, `api/routes/nearby.ts`, `api/lib/placesProvider.ts` | Live hotels near a searched destination or the browser's location (Nominatim geocoding + Overpass, or Google Places when configured): photos, address, distance, contact, facilities, filters, map markers, external booking links. The curated sample inventory with request-based booking lives at `/hotels/curated`. |
| 3. Restaurant discovery + reservations | `/restaurants`, `/nearby`, `api/routes/nearby.ts` | Live restaurants around the same point: cuisine, distance, rating/price and open-now filters when the provider supplies them, map, contact and reservation links. Curated samples and table requests live at `/restaurants/curated`. |
| 4. Nearby attractions | `/attractions`, `/attractions/:slug` | Category and 5/10/25/50 km distance filters, hidden-gem flag, opening hours, entry fees, visit duration, visitor notes, directions, add-to-itinerary. |
| 5. AI assistant | Floating "Ask Trippy", `api/routes/ai.ts` | Conversational travel Q&A grounded in destination/hotel/restaurant data and the user's coordinates; returns linked cards. |
| 6. Budget calculator | `/budget`, `api/lib/planner.ts` | Accommodation, food, transport, activities and buffer breakdown; total, per-person, daily and remaining budget; actual expense logging. |
| 7. Digital travel passport | `/passport` | Stamps per destination/date/rating, UNESCO and hidden-gem counts, eight achievement badges with progress, destination history. |
| 8. Personal dashboard | `/profile` | Profile editing, upcoming/past trips, stay requests, table requests, saved places, Travel DNA, private photos, notifications. |
| A. Travel DNA | `/profile?tab=preferences`, `/api/recommendations` | Interest/budget/pace preferences combined with passport history to score and explain destination recommendations. |
| B. Explore around me | Home + `/explore`, `/api/nearby` | Browser geolocation → nearest attractions, hotels, restaurants and destinations with road-distance estimates. |
| C. Time-based exploration | Home panel, `/api/ai/mini-plan` | "I have 3 hours" → a route that fits the window using distance, travel time and visit duration. |
| D. Hidden gems | `/explore?hidden=1`, `/attractions?hidden=1` | Less-explored destinations and attractions are flagged and filterable. |
| E. One-click journey integration | Trip editor → "Add places" | Add hotels, restaurants and attractions to any day, reorder, delete, and see the whole journey on one map. |
| F. Budget-aware recommendations | Planner, assistant, `/api/recommendations` | Hotel/restaurant choices respond to the stated budget and budget level. |
| G. Travel memory timeline | `/history` | Trips, passport stamps and private photographs merged into a chronological, year-grouped timeline. |

Primary navigation: Home, Explore, AI Trip Planner, Hotels, Restaurants, My Trips, and Profile/Login — with Attractions, Guides, Budget, Passport and History under **More** and in the footer. Every page in the brief is a real route.

---

## 2. Stack and architecture

- **Frontend:** React 18 + TypeScript + Vite, React Router, Leaflet + OpenStreetMap tiles, hand-built CSS design system (no UI framework).
- **Backend:** Hono on Cloudflare Workers, served from the same origin as the SPA.
- **Database:** Cloudflare D1 (SQLite), full relational schema with foreign keys and indexes.
- **Storage:** Cloudflare R2 for private travel photographs.
- **Auth:** email + password (PBKDF2-SHA256, 120k iterations, per-user salt) with HMAC-SHA256 session tokens in an HttpOnly, SameSite=Lax cookie.
- **AI:** optional OpenAI chat completions on the server; a deterministic, data-driven planner and retrieval assistant when no key is configured.
- **Maps/routing:** Leaflet + OSM; distances use haversine × 1.28 road factor and a conservative 32 km/h travel-time model. No key required.

```
Browser (React SPA)
   │  same-origin fetch("/api/…"), HttpOnly session cookie
Cloudflare Worker (Hono)
   ├── D1  — users, trips, bookings, passport, photos metadata, inventory
   ├── R2  — travel photo objects (private, per user)
   └── OpenAI (optional, server-side key only)
Static assets served via env.ASSETS (SPA fallback)
```

Row-level security equivalent: every personal query is scoped by the user id resolved from the signed session cookie, never from a client-supplied id. Mutations also require a same-origin `Origin` header, and auth endpoints are throttled per isolate.

---

## 3. Quick start (local)

**Requirement:** Node.js 20+ to run Wrangler. Wrangler cannot forward requests under Bun yet (`Bun fetch ignores the undici dispatcher`), so the dev server must run on Node. This project includes a local Node at `.tools/node` if the machine has none; the helper scripts detect it automatically.

```bash
# 1. Install dependencies (bun or npm)
bun install           # or: npm install

# 2. Create the local database and load reference data
./scripts/init-db.sh

# 3. Build the client and Worker bundle
./scripts/build.sh

# 4. Run
./scripts/start.sh    # http://127.0.0.1:8787
```

Reset the local database at any time with `rm -rf .wrangler/state && ./scripts/init-db.sh`.

The local D1 database and R2 bucket are simulated by Wrangler under `.wrangler/state`. Reference data: **21 destinations, 75 attractions, 28 hotels, 28 restaurants, 8 guides**. All hotel and restaurant inventory is sample data and labelled as such in the UI.

---

## 4. Environment variables

| Name | Required | Purpose |
| --- | --- | --- |
| `JWT_SECRET` | Yes in production | HMAC key for session tokens (`openssl rand -hex 32`). Local dev uses a clearly-labelled placeholder from `wrangler.jsonc`. |
| `OPENAI_API_KEY` | No | Enables live AI itineraries and conversational answers. Without it the built-in engine is used and labelled as such. |
| `OPENAI_BASE_URL` | No | Defaults to `https://api.openai.com/v1`. Any OpenAI-compatible endpoint works. |
| `OPENAI_MODEL` | No | Defaults to `gpt-4o-mini`; the server allowlists `gpt-4o-mini`, `gpt-4.1-mini`, `gpt-4o`, `gpt-4.1`. |
| `GOOGLE_PLACES_API_KEY` | No | Enables Google Places API (New) for nearby results, which adds ratings, review counts, price level, opening hours and photos. Without it, keyless OpenStreetMap (Overpass + Nominatim) is used. Server-side only. |
| `GEO_USER_AGENT` | No | Identifying User-Agent for Nominatim, whose usage policy requires one. Set it to your app name and contact URL in production. |
| `OVERPASS_URL` | No | Overrides the default Overpass endpoint (e.g. a self-hosted instance). |

Local development values are in `wrangler.jsonc` (`vars`). For production set real secrets:

```bash
npx wrangler secret put JWT_SECRET
npx wrangler secret put OPENAI_API_KEY   # optional
```

Never put keys in `src/`, `public/` or `dist/`; the client never receives them.

---

## 5. AI behaviour

**With `OPENAI_API_KEY`:** the planner sends the destination's real inventory (attraction ids, categories, fees, durations, hotels, restaurants) and asks for strict JSON. The response is validated — unknown place ids are discarded, costs and coordinates are recomputed from the database. The assistant uses a grounded prompt and only answers from retrieved context.

**Without a key:** `api/lib/planner.ts` builds the itinerary deterministically (interest scoring, nearest-neighbour ordering, pace-based stop counts, meal and stay selection). The assistant (`api/lib/ai.ts`) resolves intent and answers from the same inventory. Both are labelled "Built-in travel engine" in the UI, so nothing pretends to be a live model.

Costs, travel times and opening hours are estimates and are labelled as estimates in the interface.

---

## 6. Demo-mode honesty

- **Hotels and restaurants are sample inventory.** Selected rates come from that dataset.
- **Bookings are requests, not confirmations.** Submitting a stay or table writes a `requested` record with a reference to your account and displays an explicit demo-mode notice. No payment is taken and no room/table is held.
- Every hotel and restaurant page links to a genuine external search (Google Travel / Google Search) for live availability. Live partner APIs (Booking.com, MakeMyTrip, Dineout, etc.) require commercial credentials and are not wired in.
- **Not enabled:** Razorpay payments, a weather API, Google Places/Google Maps key-based services, email/SMS delivery. The map layer is OpenStreetMap, which needs no key.
- Ratings/review counts are sample aggregates; the UI says so where relevant.

---

## 7. Database

`schema.sql` is the D1 dialect (SQLite); `supabase/schema.sql` is the PostgreSQL + Row Level Security alternative.

Tables: `users`, `user_profiles`, `user_preferences`, `destinations`, `attractions`, `hotels`, `restaurants`, `itineraries`, `itinerary_items`, `hotel_bookings`, `restaurant_reservations`, `saved_places`, `travel_expenses`, `heritage_passport`, `travel_photos`, `notifications`, `guides`.

- Foreign keys with `ON DELETE CASCADE` for owned rows, `SET NULL` for loose references.
- Indexes on every foreign key used for filtering, plus notification and hidden-destination lookups.
- Server-side validation for dates, guest/room limits, opening hours, budgets and ownership.

Apply to a production D1 database:

```bash
npx wrangler d1 create tripsphere-db          # copy the returned id into wrangler.jsonc
npx wrangler r2 bucket create tripsphere-photos
npx wrangler d1 execute tripsphere-db --remote --file=db/schema.sql
npx wrangler d1 execute tripsphere-db --remote --file=db/seed-1-destinations.sql
# …repeat for db/seed-2 … db/seed-6
```

### Using Supabase instead

`supabase/schema.sql` recreates the schema in PostgreSQL with `auth.users` linkage and RLS policies (public read for inventory, owner-only for personal rows). It is provided for teams standardised on Supabase. The running application uses D1; switching backends means porting `api/lib/db.ts` queries and the auth/session layer to Supabase Auth and its Postgres client. Supabase Edge Functions are not part of this implementation.

---

## 8. API reference

All routes are under `/api` and same-origin.

| Method | Path | Auth | Purpose |
| --- | --- | --- | --- |
| POST | `/auth/register`, `/auth/login`, `/auth/logout` | – | Account and session. |
| GET | `/auth/me` | optional | Session user, profile, preferences, counts. |
| GET | `/destinations`, `/destinations/:slug` | – | Destination discovery and detail (attractions, hotels, restaurants, guides). |
| GET | `/places?type=hotel\|restaurant\|attraction` | – | Unified place search with destination, price, rating, cuisine, category, amenity, radius and sort filters. |
| GET | `/places/:type/:slug` | – | Place detail. |
| GET | `/nearby?lat&lng&radius` | – | Location-aware grouped discovery from the curated inventory. |
| GET | `/geo/search?q=`, `/geo/reverse?lat&lng` | – | Nominatim geocoding for the destination search (rate-limited, 24 h cache). |
| GET | `/nearby/places?lat&lng&kind=hotel\|restaurant&radius` | – | Live nearby places from the configured provider. |
| GET | `/nearby/config` | – | Active provider, capabilities and attribution. |
| GET | `/nearby/photo?ref=` | – | Google Places photo proxy (keeps the key server-side). |
| GET | `/search?q=` | – | Global suggestions. |
| GET | `/recommendations`, `/travel-dna` | optional / yes | Travel DNA recommendations. |
| GET | `/guides`, `/guides/:slug` | – | Editorial guides. |
| POST | `/trips/generate` | optional | Generate an itinerary (not saved). |
| GET/POST | `/trips` | yes | List / save trips. |
| GET/PATCH/DELETE | `/trips/:id` | yes | Trip detail and metadata. |
| POST | `/trips/:id/share` | yes | Create a public share token. |
| GET | `/trips/share/:token` | – | Public shared itinerary (owner's first name only). |
| POST | `/trips/:id/items`, `…/items/:itemId/move` | yes | Add / reorder stops. |
| PATCH/DELETE | `/trips/:id/items/:itemId` | yes | Edit time, day, notes; remove a stop. |
| GET | `/trips/:id/budget` | yes | Estimate from the trip's dates, hotel and transport. |
| POST/GET | `/bookings/hotels`, `/bookings/restaurants` | yes | Create and list requests. |
| POST | `/bookings/hotels/:id/cancel`, `/bookings/restaurants/:id/cancel` | yes | Cancel a request. |
| GET/POST/DELETE | `/passport` | yes | Stamps, stats, badges. |
| GET/POST/DELETE | `/photos`, `/photos/:id/file` | yes | Private photo upload and retrieval (R2). |
| GET/PUT | `/saved`, `/preferences`, `/expenses` | yes | Saved places, Travel DNA, real spending. |
| GET | `/budget/estimate` | – | Budget breakdown for a destination. |
| GET | `/dashboard` | yes | Everything the dashboard needs in one call. |
| GET/POST | `/notifications`, `/notifications/read` | yes | Notification feed. |
| GET | `/ai/status` | – | Which AI engine is active. |
| POST | `/ai/assistant`, `/ai/mini-plan` | – | Conversational assistant and time-boxed route. |
| GET | `/health` | – | Service probe. |

---

## 9. Project structure

```
api/                  Worker API (Hono)
  index.ts            app, security headers, routing, SPA fallback
  lib/                auth, crypto, db helpers, geo, places, planner, AI
  routes/             auth, discovery, trips, bookings, user, ai
src/                  React client
  components/         Layout, Assistant, MapView, Cards, UI, guards
  lib/                api client, auth context, types, geo, trip helpers
  pages/              Home, Explore, Plan, Hotels, Restaurants, Attractions,
                      Guides, History, Trips, Profile, Passport, Budget, Auth
  styles.css          design system
db/                   D1 schema + six seed files
supabase/             PostgreSQL schema with RLS
scripts/              build, db init, start helpers
public/               generated destination imagery, favicon
wrangler.jsonc        local Worker config (D1, R2, assets)
deploy.manifest.json  asset + module manifest for platform deployment
```

---

## 10. Testing

Automated checks used while building:

```bash
npx tsc -p tsconfig.worker.json --noEmit
npx tsc -p tsconfig.json --noEmit
./scripts/build.sh
```

Manual API verification performed against the local Worker (Wrangler + workerd): registration, login, session `me`, unauthorised 401, itinerary generation and saving, trip budget, adding/moving/deleting itinerary stops, trip sharing and public share fetch, hotel and restaurant request creation, invalid date rejection, out-of-hours reservation rejection, passport stamp creation and badge stats, photo upload and private file retrieval, assistant intent replies, mini-plan generation, saved-place toggling, preference updates and the dashboard aggregate.

Not verified: click-through of every page and control in a browser, real OpenAI responses (no key configured), live provider booking APIs, and payment flows. The UI was built and the server-side rendering/data paths were exercised; interactive behaviour should be checked in the preview before a real launch.

---

## 11. Deployment

### Cloudflare Workers (recommended)

```bash
./scripts/build.sh
npx wrangler d1 create tripsphere-db        # update database_id in wrangler.jsonc
npx wrangler r2 bucket create tripsphere-photos
npx wrangler d1 execute tripsphere-db --remote --file=db/schema.sql
# load seeds…
npx wrangler secret put JWT_SECRET
npx wrangler deploy
```

`wrangler.jsonc` already routes all requests through the Worker, with `ASSETS` bound to `dist` and SPA fallback enabled. Add a custom domain in the Cloudflare dashboard afterward.

### Platform deployment (Sites-style manifest)

Build, then deploy the manifest: `deploy.manifest.json` points at `dist-worker/index.js` and `./dist`, with `spa: true`. The environment needs the `DB` (D1) and `FILES` (R2) bindings and a `JWT_SECRET` secret. Apply `db/schema.sql` and the six seed files to that D1 database before first use.

### Supabase variant

Apply `supabase/schema.sql` to a Supabase project, enable email auth if you want Supabase-managed sessions, and host the built SPA on any static host. The Worker API would need its data layer ported to Supabase Postgres and its session layer to Supabase Auth; the React client only depends on the documented `/api` contract, so the port is contained to the server.

---

## 12. Known limitations

- Travel times and distances are modelled estimates, not turn-by-turn routes (no routing API key).
- Itinerary costs are approximations built from inventory prices, not quotes.
- The curated hotel/restaurant inventory (`/hotels/curated`, `/restaurants/curated`) is editorial sample data with fictional names.
- Live nearby discovery uses OpenStreetMap by default: real places, addresses and coordinates, but ratings, prices and often photos are absent, so those filters and fields are hidden until `GOOGLE_PLACES_API_KEY` is set. Overpass coverage varies by area, and provider rate limits apply (results are cached in-memory per isolate for 10 minutes; geocoding for 24 hours).
- Booking and reservation buttons open the provider's own page or a Google Travel/search page; TRIPSPHERE never reports a confirmed reservation.
- No payment provider, weather service or third-party review source is connected.
- Itineraries are single-destination: stops can be added, reordered and removed, but a multi-city trip needs one saved itinerary per city.
- AI output is only as good as the supplied inventory; the smart engine is deterministic and will repeat a style of plan for similar inputs.
- The assistant and auth endpoints use per-isolate throttling, which is best-effort rather than a global rate limit.
