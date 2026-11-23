import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatINR, timeAgo } from '../lib/geo';
import { useAuth } from '../lib/auth';
import { INTERESTS, INTEREST_LABELS, PACE_OPTIONS, TRANSPORT_OPTIONS } from '../lib/trip';
import type { Destination, HotelBooking, Notification, PassportEntry, Photo, Reservation, Trip } from '../lib/types';
import AuthGuard from '../components/AuthGuard';
import { Alert, Chip, Empty, Loading, Stat, Tabs } from '../components/UI';

interface Dashboard {
  user: { id: number; name: string; email: string };
  profile: { bio?: string; home_city?: string; phone?: string } | null;
  preferences: { interests: string[]; budget_level: string; pace: string; transport: string; dietary?: string };
  trips: { upcoming: Trip[]; past: Trip[]; all: Trip[] };
  bookings: (HotelBooking & { id: number })[];
  reservations: (Reservation & { id: number })[];
  saved: { id: number; placeType: string; placeId: number; name: string; slug: string; image: string; summary: string; href: string }[];
  passport: { entries: number; destinations: number; unesco: number };
  photos: Photo[];
  notifications: Notification[];
  unread: number;
  travelDNA: string[];
}

type Tab = 'overview' | 'bookings' | 'reservations' | 'saved' | 'preferences' | 'photos';

export default function Profile() {
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') ?? 'overview') as Tab;
  const { user, refresh } = useAuth();
  const [data, setData] = useState<Dashboard | null>(null);
  const [loading, setLoading] = useState(true);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [destinations, setDestinations] = useState<Destination[]>([]);

  const [prefs, setPrefs] = useState({ interests: [] as string[], budgetLevel: 'mid', pace: 'balanced', transport: 'car', dietary: '' });
  const [profileForm, setProfileForm] = useState({ name: '', homeCity: '', bio: '', phone: '' });
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoCaption, setPhotoCaption] = useState('');
  const [photoDestination, setPhotoDestination] = useState('');
  const [uploading, setUploading] = useState(false);

  async function load() {
    try {
      const payload = await api<Dashboard>('/dashboard');
      setData(payload);
      setPrefs({
        interests: payload.preferences?.interests ?? [],
        budgetLevel: payload.preferences?.budget_level ?? 'mid',
        pace: payload.preferences?.pace ?? 'balanced',
        transport: payload.preferences?.transport ?? 'car',
        dietary: payload.preferences?.dietary ?? '',
      });
      setProfileForm({
        name: payload.user.name,
        homeCity: payload.profile?.home_city ?? '',
        bio: payload.profile?.bio ?? '',
        phone: payload.profile?.phone ?? '',
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load your dashboard');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!user) {
      setLoading(false);
      return;
    }
    void load();
    api<{ destinations: Destination[] }>('/destinations?limit=60')
      .then((result) => setDestinations(result.destinations))
      .catch(() => undefined);
  }, [user]);

  const upcoming = data?.trips.upcoming?.[0] ?? null;
  const stampEntries = useMemo(() => data?.photos ?? [], [data]);

  if (loading) return <div className="wrap"><Loading label="Opening your dashboard" /></div>;

  function setTab(next: Tab) {
    const nextParams = new URLSearchParams(params);
    nextParams.set('tab', next);
    setParams(nextParams, { replace: true });
  }

  async function toggleSave(placeType: string, placeId: number) {
    await api('/saved', { method: 'POST', body: { placeType, placeId } });
    await load();
  }

  async function cancelBooking(id: number) {
    await api(`/bookings/hotels/${id}/cancel`, { method: 'POST' });
    await load();
    setNotice('Booking request cancelled.');
  }

  async function cancelReservation(id: number) {
    await api(`/bookings/restaurants/${id}/cancel`, { method: 'POST' });
    await load();
    setNotice('Reservation request cancelled.');
  }

  async function savePreferences() {
    await api('/preferences', { method: 'PUT', body: prefs });
    await load();
    await refresh();
    setNotice('Travel DNA updated. Recommendations will follow these interests.');
  }

  async function saveProfile() {
    await api('/profile', { method: 'PATCH', body: profileForm });
    await load();
    await refresh();
    setNotice('Profile updated.');
  }

  async function uploadPhoto() {
    if (!photoFile) return;
    setUploading(true);
    const form = new FormData();
    form.append('file', photoFile);
    form.append('caption', photoCaption);
    if (photoDestination) form.append('destinationId', photoDestination);
    try {
      await api('/photos', { method: 'POST', form });
      setPhotoFile(null);
      setPhotoCaption('');
      await load();
      setNotice('Photo added to your travel memories.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Upload failed');
    } finally {
      setUploading(false);
    }
  }

  return (
    <AuthGuard title="Sign in to open your dashboard">
      <div className="wrap">
        <header className="page-head">
          <div className="row-between row-wrap" style={{ alignItems: 'flex-end' }}>
            <div>
              <span className="eyebrow">Dashboard</span>
              <h1>{user ? `Hello, ${user.name.split(' ')[0]}.` : 'Your travel desk'}</h1>
              <p>Trips, bookings, saved places, your passport and the memories you keep.</p>
            </div>
            <div className="row">
              <Link to="/plan" className="btn btn-sm">Plan a trip</Link>
              <Link to="/passport" className="btn btn-sm btn-ghost">Open passport</Link>
            </div>
          </div>
        </header>

        {notice && <div style={{ marginBottom: 16 }}><Alert tone="ok">{notice}</Alert></div>}
        {error && <div style={{ marginBottom: 16 }}><Alert tone="error">{error}</Alert></div>}

        <div className="stat-grid" style={{ marginBottom: 26 }}>
          <Stat label="Destinations stamped" value={data?.passport.destinations ?? 0} />
          <Stat label="Saved trips" value={data?.trips.all.length ?? 0} />
          <Stat label="Stay requests" value={data?.bookings.length ?? 0} />
          <Stat label="Table requests" value={data?.reservations.length ?? 0} />
          <Stat label="Saved places" value={data?.saved.length ?? 0} />
        </div>

        <Tabs<Tab>
          tabs={[
            { id: 'overview', label: 'Overview' },
            { id: 'bookings', label: 'Bookings' },
            { id: 'reservations', label: 'Reservations' },
            { id: 'saved', label: 'Saved' },
            { id: 'preferences', label: 'Travel DNA' },
            { id: 'photos', label: 'Photos' },
          ]}
          value={tab}
          onChange={setTab}
        />

        {tab === 'overview' && (
          <div className="split">
            <div className="side">
              {upcoming ? (
                <div className="place-card">
                  <Link to={`/trips/${upcoming.id}`} className="dest-media" style={{ aspectRatio: '16 / 7' }}>
                    <img src={upcoming.destination_image ?? upcoming.destination?.image ?? '/images/hero.jpg'} alt="" />
                    <span className="float-tag">Next trip</span>
                  </Link>
                  <div className="place-body">
                    <h3 className="place-title">{upcoming.title}</h3>
                    <p className="dest-summary">
                      {formatDate(upcoming.start_date, { day: 'numeric', month: 'long' })} · {upcoming.travellers} travellers ·{' '}
                      {upcoming.item_count ?? upcoming.items?.length ?? 0} stops
                    </p>
                    <div className="row" style={{ marginTop: 8 }}>
                      <Link to={`/trips/${upcoming.id}`} className="btn btn-sm">Open itinerary</Link>
                      <Link to={`/trips/${upcoming.id}`} className="btn btn-sm btn-ghost">Share</Link>
                    </div>
                  </div>
                </div>
              ) : (
                <Empty title="No upcoming trips">
                  <p style={{ marginBottom: 14 }}>The planner can build one around your dates and budget.</p>
                  <Link to="/plan" className="btn btn-sm">Plan a trip</Link>
                </Empty>
              )}

              <div className="panel">
                <div className="row-between" style={{ marginBottom: 12 }}>
                  <span className="eyebrow">Notifications</span>
                  <button
                    type="button"
                    className="link"
                    style={{ background: 'none', border: 0, fontSize: 11 }}
                    onClick={async () => {
                      await api('/notifications/read', { method: 'POST' });
                      await load();
                    }}
                  >
                    Mark all read
                  </button>
                </div>
                {(data?.notifications ?? []).length === 0 && <p className="form-note">Nothing yet.</p>}
                <div className="col" style={{ gap: 10 }}>
                  {(data?.notifications ?? []).map((item) => (
                    <div key={item.id} className="row" style={{ alignItems: 'flex-start', gap: 10 }}>
                      <span
                        style={{
                          width: 7,
                          height: 7,
                          borderRadius: '50%',
                          background: item.read ? 'var(--line-strong)' : 'var(--clay)',
                          marginTop: 7,
                          flexShrink: 0,
                        }}
                      />
                      <div className="grow">
                        <div style={{ fontSize: 12.5, fontWeight: item.read ? 400 : 600 }}>
                          {item.link ? <Link to={item.link}>{item.title}</Link> : item.title}
                        </div>
                        <div className="muted" style={{ fontSize: 11, lineHeight: 1.55 }}>{item.body}</div>
                        <div className="muted" style={{ fontSize: 9.5, marginTop: 2 }}>{timeAgo(item.created_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            <div className="side">
              <div className="panel">
                <span className="eyebrow">Profile</span>
                <div className="form-grid" style={{ marginTop: 12, gap: 10 }}>
                  <div className="field span-2">
                    <label>Name</label>
                    <input value={profileForm.name} onChange={(event) => setProfileForm({ ...profileForm, name: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>Home city</label>
                    <input value={profileForm.homeCity} placeholder="Bengaluru" onChange={(event) => setProfileForm({ ...profileForm, homeCity: event.target.value })} />
                  </div>
                  <div className="field">
                    <label>Phone</label>
                    <input value={profileForm.phone} onChange={(event) => setProfileForm({ ...profileForm, phone: event.target.value })} />
                  </div>
                  <div className="field span-2">
                    <label>About your travel style</label>
                    <textarea rows={3} value={profileForm.bio} onChange={(event) => setProfileForm({ ...profileForm, bio: event.target.value })} />
                  </div>
                </div>
                <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={saveProfile}>Save profile</button>
              </div>

              <div className="panel">
                <span className="eyebrow">Travel DNA</span>
                <div className="chip-row" style={{ marginTop: 10 }}>
                  {(data?.travelDNA.length ? data.travelDNA : data?.preferences.interests ?? []).map((interest) => (
                    <span className="tag tag-sage" key={interest}>{interest}</span>
                  ))}
                  {!data?.travelDNA.length && !data?.preferences.interests.length && (
                    <span className="muted" style={{ fontSize: 12 }}>Not set yet.</span>
                  )}
                </div>
                <div className="col" style={{ gap: 6, marginTop: 14, fontSize: 12 }}>
                  <div className="row-between"><span className="muted">Budget style</span><strong>{data?.preferences.budget_level}</strong></div>
                  <div className="row-between"><span className="muted">Pace</span><strong>{data?.preferences.pace}</strong></div>
                  <div className="row-between"><span className="muted">Usual transport</span><strong>{data?.preferences.transport}</strong></div>
                </div>
                <button type="button" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setTab('preferences')}>
                  Adjust preferences
                </button>
              </div>

              <div className="panel">
                <span className="eyebrow">Recent memories</span>
                <div className="row row-wrap" style={{ gap: 8, marginTop: 10 }}>
                  {stampEntries.length === 0 && <span className="muted" style={{ fontSize: 12 }}>Upload photos from your trips.</span>}
                  {stampEntries.slice(0, 3).map((photo) => (
                    <img key={photo.id} src={photo.url} alt={photo.caption ?? ''} style={{ width: 76, height: 76, objectFit: 'cover', borderRadius: 10 }} />
                  ))}
                </div>
                <button type="button" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 12 }} onClick={() => setTab('photos')}>
                  Manage photos
                </button>
              </div>
            </div>
          </div>
        )}

        {tab === 'bookings' && (
          <div className="place-list">
            {(data?.bookings ?? []).length === 0 && <Empty title="No stay requests yet">Find a hotel and log a request.</Empty>}
            {(data?.bookings ?? []).map((booking) => (
              <div className="panel" key={booking.id}>
                <div className="row-between row-wrap" style={{ gap: 14 }}>
                  <div className="row" style={{ gap: 14 }}>
                    <img src={booking.hotel_image} alt="" style={{ width: 68, height: 68, borderRadius: 10, objectFit: 'cover' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {booking.hotel_slug ? <Link to={`/hotels/${booking.hotel_slug}`}>{booking.hotel_name}</Link> : booking.hotel_name}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {booking.destination_name} · {formatDate(booking.check_in)} → {formatDate(booking.check_out)} · {booking.nights} night{booking.nights > 1 ? 's' : ''}
                      </div>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className={`tag ${booking.status === 'cancelled' ? 'tag-clay' : 'tag-sage'}`}>{booking.status}</span>
                        <span className="tag">Ref {booking.reference}</span>
                        <span className="tag tag-gold">demo mode</span>
                      </div>
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 600 }}>{formatINR(booking.total_amount)}</div>
                    <div className="muted" style={{ fontSize: 10.5 }}>{booking.rooms} room(s) · {booking.guests} guests</div>
                    {booking.status === 'requested' && (
                      <button type="button" className="btn btn-sm btn-ghost" style={{ marginTop: 8 }} onClick={() => cancelBooking(booking.id)}>
                        Cancel request
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
            <p className="form-note">
              Requests are logged in demo mode. No payment has been taken and no room is held — use the live partner link
              on each hotel page to confirm.
            </p>
          </div>
        )}

        {tab === 'reservations' && (
          <div className="place-list">
            {(data?.reservations ?? []).length === 0 && <Empty title="No table requests yet">Find a restaurant and request a table.</Empty>}
            {(data?.reservations ?? []).map((reservation) => (
              <div className="panel" key={reservation.id}>
                <div className="row-between row-wrap" style={{ gap: 14 }}>
                  <div className="row" style={{ gap: 14 }}>
                    <img src={reservation.restaurant_image} alt="" style={{ width: 68, height: 68, borderRadius: 10, objectFit: 'cover' }} />
                    <div>
                      <div style={{ fontWeight: 600, fontSize: 14 }}>
                        {reservation.restaurant_slug ? <Link to={`/restaurants/${reservation.restaurant_slug}`}>{reservation.restaurant_name}</Link> : reservation.restaurant_name}
                      </div>
                      <div className="muted" style={{ fontSize: 11.5 }}>
                        {reservation.destination_name} · {reservation.date} at {reservation.time} · {reservation.guests} guests
                      </div>
                      <div className="row" style={{ gap: 6, marginTop: 6 }}>
                        <span className={`tag ${reservation.status === 'cancelled' ? 'tag-clay' : 'tag-sage'}`}>{reservation.status}</span>
                        <span className="tag">Ref {reservation.reference}</span>
                        <span className="tag tag-gold">demo mode</span>
                      </div>
                    </div>
                  </div>
                  {reservation.status === 'requested' && (
                    <button type="button" className="btn btn-sm btn-ghost" onClick={() => cancelReservation(reservation.id)}>
                      Cancel request
                    </button>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}

        {tab === 'saved' && (
          <>
            {(data?.saved ?? []).length === 0 && <Empty title="Nothing saved yet">Tap the heart on any destination, hotel, restaurant or attraction.</Empty>}
            <div className="dest-grid">
              {(data?.saved ?? []).map((item) => (
                <div className="dest-card" key={item.id}>
                  <Link to={item.href} className="dest-media">
                    <img src={item.image} alt={item.name} />
                    <span className="float-tag">{item.placeType}</span>
                  </Link>
                  <div className="dest-body">
                    <Link to={item.href}><h3 className="dest-title" style={{ fontSize: 19 }}>{item.name}</h3></Link>
                    <p className="dest-summary">{item.summary}</p>
                    <div className="dest-foot">
                      <button
                        type="button"
                        className="link"
                        style={{ background: 'none', border: 0 }}
                        onClick={() => toggleSave(item.placeType, item.placeId)}
                      >
                        Remove
                      </button>
                      <Link to={item.href} className="link">Open →</Link>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </>
        )}

        {tab === 'preferences' && (
          <div className="split">
            <div className="panel">
              <span className="eyebrow">Travel DNA</span>
              <h2 style={{ fontSize: 27, margin: '8px 0 6px' }}>What kind of trip feels like yours?</h2>
              <p className="form-note" style={{ marginBottom: 18 }}>
                These preferences drive recommendations, the planner defaults and the assistant's suggestions.
              </p>
              <div className="field" style={{ marginBottom: 14 }}>
                <label>Interests</label>
                <div className="chip-row">
                  {INTERESTS.map((interest) => (
                    <Chip
                      key={interest}
                      active={prefs.interests.includes(interest)}
                      onClick={() =>
                        setPrefs((prev) => ({
                          ...prev,
                          interests: prev.interests.includes(interest)
                            ? prev.interests.filter((i) => i !== interest)
                            : [...prev.interests, interest],
                        }))
                      }
                    >
                      {INTEREST_LABELS[interest] ?? interest}
                    </Chip>
                  ))}
                </div>
              </div>
              <div className="form-grid">
                <div className="field">
                  <label>Budget style</label>
                  <select value={prefs.budgetLevel} onChange={(event) => setPrefs({ ...prefs, budgetLevel: event.target.value })}>
                    <option value="budget">Budget — under ₹2,800/day</option>
                    <option value="mid">Mid — ₹2,800 to ₹5,000/day</option>
                    <option value="luxury">Luxury — ₹5,000+/day</option>
                  </select>
                </div>
                <div className="field">
                  <label>Pace</label>
                  <select value={prefs.pace} onChange={(event) => setPrefs({ ...prefs, pace: event.target.value })}>
                    {PACE_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Usual transport</label>
                  <select value={prefs.transport} onChange={(event) => setPrefs({ ...prefs, transport: event.target.value })}>
                    {TRANSPORT_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                </div>
                <div className="field">
                  <label>Dietary preference</label>
                  <input value={prefs.dietary} placeholder="Vegetarian, Jain, no shellfish…" onChange={(event) => setPrefs({ ...prefs, dietary: event.target.value })} />
                </div>
              </div>
              <button type="button" className="btn" style={{ marginTop: 18 }} onClick={savePreferences}>
                Save Travel DNA
              </button>
            </div>
            <div className="side">
              <div className="panel">
                <span className="eyebrow">How this is used</span>
                <div className="col" style={{ gap: 12, marginTop: 12 }}>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Recommendations</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>Destinations are scored against your interests and budget, and destinations you have already stamped drop down the list.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Planner defaults</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>New trips pre-fill your interests, pace, transport and a budget band.</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 12.5, fontWeight: 600 }}>Assistant</div>
                    <div className="muted" style={{ fontSize: 11.5 }}>Trippy uses your location and preferences for nearby suggestions.</div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}

        {tab === 'photos' && (
          <>
            <div className="panel" style={{ marginBottom: 20 }}>
              <span className="eyebrow">Add a memory</span>
              <div className="form-grid" style={{ marginTop: 12 }}>
                <div className="field">
                  <label>Photo (JPEG, PNG or WebP, max 5 MB)</label>
                  <input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setPhotoFile(event.target.files?.[0] ?? null)} />
                </div>
                <div className="field">
                  <label>Destination</label>
                  <select value={photoDestination} onChange={(event) => setPhotoDestination(event.target.value)}>
                    <option value="">Not specified</option>
                    {destinations.map((destination) => (
                      <option key={destination.id} value={destination.id}>{destination.name}</option>
                    ))}
                  </select>
                </div>
                <div className="field span-2">
                  <label>Caption</label>
                  <input value={photoCaption} placeholder="Sunrise over the boulders" onChange={(event) => setPhotoCaption(event.target.value)} />
                </div>
              </div>
              <button type="button" className="btn btn-sm" style={{ marginTop: 12 }} onClick={uploadPhoto} disabled={!photoFile || uploading}>
                {uploading ? 'Uploading…' : 'Upload photo'}
              </button>
            </div>
            {(data?.photos ?? []).length === 0 ? (
              <Empty title="No photos yet">Your photos stay private and appear in your travel timeline.</Empty>
            ) : (
              <div className="dest-grid">
                {(data?.photos ?? []).map((photo) => (
                  <div className="dest-card" key={photo.id}>
                    <img src={photo.url} alt={photo.caption ?? 'Travel photo'} style={{ width: '100%', aspectRatio: '4/3', objectFit: 'cover' }} />
                    <div className="dest-body">
                      <div style={{ fontSize: 13, fontWeight: 600 }}>{photo.caption || 'Untitled memory'}</div>
                      <div className="muted" style={{ fontSize: 11 }}>{formatDate(photo.created_at.slice(0, 10), { day: 'numeric', month: 'short', year: 'numeric' })}</div>
                      <button
                        type="button"
                        className="link"
                        style={{ background: 'none', border: 0, fontSize: 11.5, textAlign: 'left' }}
                        onClick={async () => {
                          await api(`/photos/${photo.id}`, { method: 'DELETE' });
                          await load();
                        }}
                      >
                        Delete photo
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </AuthGuard>
  );
}
