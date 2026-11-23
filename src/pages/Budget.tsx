import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, qs } from '../lib/api';
import { formatINR } from '../lib/geo';
import { useAuth } from '../lib/auth';
import type { BudgetEstimate, Trip } from '../lib/types';
import { TRANSPORT_OPTIONS } from '../lib/trip';
import DestinationPicker from '../components/DestinationPicker';
import { Alert, Empty, Loading, Stat } from '../components/UI';

const CATEGORY_LABEL: Record<string, string> = {
  accommodation: 'Accommodation',
  food: 'Food',
  transport: 'Transport',
  activities: 'Activities',
  other: 'Other',
};

const BAR_COLORS = ['', 'gold', 'sage', 'ink', ''];

export default function Budget() {
  const [params] = useSearchParams();
  const { user } = useAuth();
  const [destinationId, setDestinationId] = useState<number | ''>(params.get('destination') ? Number(params.get('destination')) : '');
  const [nights, setNights] = useState(3);
  const [travellers, setTravellers] = useState(2);
  const [transport, setTransport] = useState('car');
  const [compare, setCompare] = useState(30000);
  const [estimate, setEstimate] = useState<BudgetEstimate | null>(null);
  const [trip, setTrip] = useState<Trip | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expenses, setExpenses] = useState<{ id: number; category: string; label: string; amount: number; spent_on: string }[]>([]);
  const [expenseTotal, setExpenseTotal] = useState(0);
  const [expenseForm, setExpenseForm] = useState({ category: 'food', label: '', amount: '' });
  const [expenseNotice, setExpenseNotice] = useState<string | null>(null);

  const itineraryId = params.get('itinerary');

  useEffect(() => {
    if (!itineraryId || !user) return;
    api<{ trip: Trip }>(`/trips/${itineraryId}`)
      .then((data) => {
        setTrip(data.trip);
        setCompare(data.trip.budget);
        setTravellers(data.trip.travellers);
        setTransport(data.trip.transport);
        if (data.trip.destination) setDestinationId(data.trip.destination.id);
        const start = data.trip.start_date;
        const end = data.trip.end_date;
        if (start && end) setNights(Math.max(1, Math.round((Date.parse(end) - Date.parse(start)) / 86_400_000)));
      })
      .catch(() => undefined);
  }, [itineraryId, user]);

  useEffect(() => {
    if (!destinationId) {
      setEstimate(null);
      return;
    }
    setLoading(true);
    setError(null);
    api<{ estimate: BudgetEstimate }>(
      `/budget/estimate${qs({ destinationId, nights, travellers, transport })}`,
    )
      .then((data) => setEstimate(data.estimate))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not estimate that trip'))
      .finally(() => setLoading(false));
  }, [destinationId, nights, travellers, transport]);

  async function loadExpenses() {
    if (!user || !itineraryId) return;
    const data = await api<{ expenses: typeof expenses; total: number }>(`/expenses?itineraryId=${itineraryId}`);
    setExpenses(data.expenses);
    setExpenseTotal(data.total);
  }

  useEffect(() => {
    void loadExpenses();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, itineraryId]);

  async function addExpense() {
    const amount = Number(expenseForm.amount);
    if (!amount) return;
    try {
      await api('/expenses', {
        method: 'POST',
        body: {
          category: expenseForm.category,
          label: expenseForm.label || CATEGORY_LABEL[expenseForm.category],
          amount,
          itineraryId: itineraryId ? Number(itineraryId) : undefined,
        },
      });
      setExpenseForm({ category: expenseForm.category, label: '', amount: '' });
      setExpenseNotice('Expense logged.');
      await loadExpenses();
    } catch (err) {
      setExpenseNotice(err instanceof Error ? err.message : 'Could not log the expense');
    }
  }

  const remaining = estimate ? compare - estimate.total : 0;

  return (
    <div className="wrap">
      <header className="page-head">
        <span className="eyebrow">Budget</span>
        <h1>Know the number before you go.</h1>
        <p>
          An honest estimate built from real prices in our inventory: rooms, meals, local transport, entries and a
          buffer. Compare it with what you want to spend, then log real costs as you travel.
        </p>
      </header>

      <div className="split">
        <div>
          <div className="panel">
            <span className="eyebrow">Trip parameters</span>
            <div className="form-grid" style={{ marginTop: 14 }}>
              <DestinationPicker value={destinationId} onChange={setDestinationId} />
              <div className="field">
                <label>Nights</label>
                <input type="number" min={1} max={30} value={nights} onChange={(event) => setNights(Math.max(1, Number(event.target.value)))} />
              </div>
              <div className="field">
                <label>Travellers</label>
                <input type="number" min={1} max={20} value={travellers} onChange={(event) => setTravellers(Math.max(1, Number(event.target.value)))} />
              </div>
              <div className="field">
                <label>Transport</label>
                <select value={transport} onChange={(event) => setTransport(event.target.value)}>
                  {TRANSPORT_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>{option.label}</option>
                  ))}
                </select>
              </div>
              <div className="field span-2">
                <label>Your budget for this trip</label>
                <input type="number" step={1000} value={compare} onChange={(event) => setCompare(Math.max(0, Number(event.target.value)))} />
              </div>
            </div>
            {trip && (
              <p className="form-note" style={{ marginTop: 10 }}>
                Using saved trip <strong>{trip.title}</strong>. <Link to={`/trips/${trip.id}`} className="link">Open itinerary</Link>
              </p>
            )}
          </div>

          {error && <div style={{ marginTop: 16 }}><Alert tone="error">{error}</Alert></div>}
          {loading && <Loading label="Adding up the trip" />}
          {!loading && !destinationId && (
            <Empty title="Pick a destination">Choose where you are going to see the estimate.</Empty>
          )}

          {estimate && !loading && (
            <>
              <div className="stat-grid" style={{ marginTop: 18 }}>
                <Stat label="Total estimate" value={formatINR(estimate.total)} />
                <Stat label="Per person" value={formatINR(estimate.perPerson)} />
                <Stat label="Per day" value={formatINR(estimate.daily)} />
                <Stat label={remaining >= 0 ? 'Budget remaining' : 'Over budget'} value={formatINR(Math.abs(remaining))} />
              </div>

              <div className="panel" style={{ marginTop: 18 }}>
                <div className="row-between">
                  <h3 style={{ fontSize: 22 }}>Where the money goes</h3>
                  <span className="tag">{estimate.nights} nights · {estimate.travellers} travellers</span>
                </div>
                <div style={{ marginTop: 18 }}>
                  {estimate.breakdown.map((row, index) => (
                    <div className="bar-row" key={row.key}>
                      <div className="bar-top">
                        <span style={{ fontWeight: 500 }}>{row.label}</span>
                        <strong>{formatINR(row.amount)}</strong>
                      </div>
                      <div className="bar">
                        <i
                          className={BAR_COLORS[index % BAR_COLORS.length]}
                          style={{ width: `${estimate.total ? (row.amount / estimate.total) * 100 : 0}%` }}
                        />
                      </div>
                      <div className="muted" style={{ fontSize: 10.5, marginTop: 4 }}>{row.note}</div>
                    </div>
                  ))}
                </div>
                <div className="alert alert-info" style={{ marginTop: 8 }}>
                  Estimates, not quotes. They exclude travel to the destination and use median prices from our sample
                  inventory. Live provider rates will differ.
                </div>
              </div>

              {itineraryId && (
                <div className="panel" style={{ marginTop: 18 }}>
                  <div className="row-between">
                    <h3 style={{ fontSize: 22 }}>Actual spending</h3>
                    <span className="tag tag-sage">{formatINR(expenseTotal)} logged</span>
                  </div>
                  {!user ? (
                    <p className="form-note" style={{ marginTop: 10 }}>
                      <Link to="/login" className="link">Sign in</Link> to log real expenses against this trip.
                    </p>
                  ) : (
                    <>
                      <div className="form-grid" style={{ marginTop: 12, gap: 10 }}>
                        <div className="field">
                          <label>Category</label>
                          <select value={expenseForm.category} onChange={(event) => setExpenseForm({ ...expenseForm, category: event.target.value })}>
                            {Object.entries(CATEGORY_LABEL).map(([key, label]) => (
                              <option key={key} value={key}>{label}</option>
                            ))}
                          </select>
                        </div>
                        <div className="field">
                          <label>Amount (₹)</label>
                          <input type="number" min={1} value={expenseForm.amount} onChange={(event) => setExpenseForm({ ...expenseForm, amount: event.target.value })} />
                        </div>
                        <div className="field span-2">
                          <label>Note</label>
                          <input value={expenseForm.label} placeholder="Auto ride to the fort" onChange={(event) => setExpenseForm({ ...expenseForm, label: event.target.value })} />
                        </div>
                      </div>
                      <button type="button" className="btn btn-sm" style={{ marginTop: 10 }} onClick={addExpense}>Log expense</button>
                      {expenseNotice && <div className="alert alert-info" style={{ marginTop: 10 }}>{expenseNotice}</div>}
                      <div className="col" style={{ gap: 8, marginTop: 14 }}>
                        {expenses.length === 0 && <p className="form-note">No expenses logged yet.</p>}
                        {expenses.map((expense) => (
                          <div key={expense.id} className="row-between" style={{ fontSize: 12.5, borderBottom: '1px solid var(--line)', paddingBottom: 8 }}>
                            <div>
                              <div style={{ fontWeight: 500 }}>{expense.label}</div>
                              <div className="muted" style={{ fontSize: 10.5 }}>{CATEGORY_LABEL[expense.category] ?? expense.category} · {expense.spent_on}</div>
                            </div>
                            <div className="row" style={{ gap: 10 }}>
                              <strong>{formatINR(expense.amount)}</strong>
                              <button
                                type="button"
                                className="link"
                                style={{ background: 'none', border: 0, fontSize: 10.5 }}
                                onClick={async () => {
                                  await api(`/expenses/${expense.id}`, { method: 'DELETE' });
                                  await loadExpenses();
                                }}
                              >
                                remove
                              </button>
                            </div>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div className="side">
          <div className="panel sticky">
            <span className="eyebrow">Budget check</span>
            {estimate ? (
              <>
                <div className="big-total" style={{ margin: '10px 0 2px' }}>{formatINR(estimate.total)}</div>
                <div className="muted" style={{ fontSize: 11.5 }}>for {estimate.travellers} travellers · {estimate.nights} nights in {estimate.destination.name}</div>
                <div className="bar" style={{ margin: '16px 0 10px', height: 9 }}>
                  <i style={{ width: `${compare ? Math.min(100, (estimate.total / compare) * 100) : 0}%`, background: remaining >= 0 ? 'var(--sage)' : 'var(--clay)' }} />
                </div>
                <div className="row-between" style={{ fontSize: 12.5 }}>
                  <span className="muted">Your budget</span>
                  <strong>{formatINR(compare)}</strong>
                </div>
                <div className="row-between" style={{ fontSize: 12.5, marginTop: 6 }}>
                  <span className="muted">{remaining >= 0 ? 'Left over' : 'Shortfall'}</span>
                  <strong style={{ color: remaining >= 0 ? 'var(--sage)' : 'var(--clay)' }}>{formatINR(Math.abs(remaining))}</strong>
                </div>
                <div className="notice" style={{ marginTop: 14 }}>
                  {remaining >= 0
                    ? 'This plan sits inside your budget. Keep a little room for splurges.'
                    : 'This plan is above your budget. Try fewer nights, a cheaper stay or shared transport.'}
                </div>
                <Link to="/hotels" className="btn btn-sm btn-ghost btn-block" style={{ marginTop: 12 }}>
                  Find a lower nightly rate
                </Link>
                <Link to="/plan" className="btn btn-sm btn-block" style={{ marginTop: 8 }}>
                  Build the itinerary
                </Link>
              </>
            ) : (
              <p className="form-note">Choose a destination and we will show the full breakdown here.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
