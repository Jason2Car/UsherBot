'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { sendNavGoal, type NavResult } from '@/lib/ros';

type Reservation = {
  id: string;
  seat_number: number;
  x_coord: number;
  y_coord: number;
  taken: boolean;
  user_id: string | null;
  checked_in: boolean;
  reserved_for: string;
  end_time: string | null;
  nav_status?: string | null;
  created_at: string;
};

const RESERVATION_DURATION_MS = 60 * 60 * 1000;
const INACTIVE_NAV_STATUSES = new Set(['aborted', 'rejected', 'canceled', 'failed']);

function toDatetimeLocal(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function addHoursToLocal(local: string, hours: number): string {
  const d = new Date(local);
  d.setTime(d.getTime() + hours * 60 * 60 * 1000);
  return toDatetimeLocal(d);
}

function reservationEndMs(r: { reserved_for: string; end_time: string | null }): number {
  if (r.end_time) return new Date(r.end_time).getTime();
  return new Date(r.reserved_for).getTime() + RESERVATION_DURATION_MS;
}

type CheckinState =
  | { phase: 'idle' }
  | { phase: 'navigating'; reservation: Reservation }
  | { phase: 'arrived'; reservation: Reservation }
  | { phase: 'failed'; reservation: Reservation; reason: string };

const CHECK_IN_WINDOW_BEFORE_MS = 15 * 60 * 1000;
const CHECK_IN_WINDOW_AFTER_MS = 60 * 60 * 1000;

type SeatLayout = { seat: number; row: number; x: number; y: number };

const SEATS: SeatLayout[] = [
  { seat: 1, row: 1, x: 4.036328315734863, y: 6.334454536437988 },
  { seat: 2, row: 1, x: 3.130171775817871, y: 3.6995787620544434 },
  { seat: 3, row: 1, x: 3.3696537017822266, y: 0.17481458187103271 },
  { seat: 4, row: 2, x: 3.3192801475524902, y: -3.300684928894043 },
  { seat: 5, row: 2, x: -1.7559852600097656, y: 5.08515739440918 },
  { seat: 6, row: 2, x: 5.855883598327637, y: -4.836338043212891 },
];

function classifyReservation(r: Reservation, nowMs: number): 'current' | 'upcoming' | 'missed' {
  const ts = new Date(r.reserved_for).getTime();
  if (ts > nowMs + CHECK_IN_WINDOW_BEFORE_MS) return 'upcoming';
  if (ts < nowMs - CHECK_IN_WINDOW_AFTER_MS) return 'missed';
  return 'current';
}

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, {
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export default function Home() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [utid, setUtid] = useState('');
  const [reservations, setReservations] = useState<Reservation[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [showReservation, setShowReservation] = useState(false);
  const [selectedSeat, setSelectedSeat] = useState<number | null>(null);
  const [startTime, setStartTime] = useState('');
  const [endTime, setEndTime] = useState('');
  const [allActiveReservations, setAllActiveReservations] = useState<Reservation[]>([]);
  const [checkin, setCheckin] = useState<CheckinState>({ phase: 'idle' });
  const [nowMs, setNowMs] = useState<number>(() => Date.now());

  useEffect(() => {
    const handle = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(handle);
  }, []);

  const { current, upcoming } = useMemo(() => {
    const c: Reservation[] = [];
    const u: Reservation[] = [];
    for (const r of reservations) {
      const bucket = classifyReservation(r, nowMs);
      if (bucket === 'current') c.push(r);
      else if (bucket === 'upcoming') u.push(r);
    }
    return { current: c, upcoming: u };
  }, [reservations, nowMs]);

  const fetchReservations = useCallback(async (id: string) => {
    setLoading(true);
    setErrorMsg('');
    const { data, error } = await supabase
      .from('requests')
      .select('*')
      .eq('user_id', id)
      .eq('checked_in', false)
      .order('reserved_for', { ascending: true });
    setLoading(false);
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    setReservations(data as Reservation[]);
  }, []);

  const isSeatBusy = useCallback(
    (seatNumber: number, startISO: string, endISO: string): boolean => {
      if (!startISO || !endISO) return false;
      const start = new Date(startISO).getTime();
      const end = new Date(endISO).getTime();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
      return allActiveReservations.some((r) => {
        if (r.seat_number !== seatNumber) return false;
        if (r.nav_status && INACTIVE_NAV_STATUSES.has(r.nav_status)) return false;
        const rStart = new Date(r.reserved_for).getTime();
        const rEnd = reservationEndMs(r);
        return rStart < end && rEnd > start;
      });
    },
    [allActiveReservations],
  );

  const openReservationModal = async () => {
    setShowReservation(true);
    setSelectedSeat(null);
    setErrorMsg('');
    const now = new Date();
    now.setMinutes(Math.ceil(now.getMinutes() / 15) * 15, 0, 0);
    const startLocal = toDatetimeLocal(now);
    setStartTime(startLocal);
    setEndTime(addHoursToLocal(startLocal, 1));

    const { data } = await supabase
      .from('requests')
      .select('*')
      .gte('end_time', new Date().toISOString());
    setAllActiveReservations((data ?? []) as Reservation[]);
  };

  const closeReservationModal = () => {
    setShowReservation(false);
    setSelectedSeat(null);
    setStartTime('');
    setEndTime('');
  };

  const onStartTimeChange = (newStart: string) => {
    const newEnd = addHoursToLocal(newStart, 1);
    setStartTime(newStart);
    setEndTime(newEnd);
    if (selectedSeat !== null && isSeatBusy(selectedSeat, newStart, newEnd)) {
      setSelectedSeat(null);
    }
  };

  const onEndTimeChange = (newEnd: string) => {
    setEndTime(newEnd);
    if (selectedSeat !== null && isSeatBusy(selectedSeat, startTime, newEnd)) {
      setSelectedSeat(null);
    }
  };

  const handleLogin = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const formData = new FormData(e.currentTarget);
    const id = (formData.get('utid') as string).trim();
    if (!id) return;
    setUtid(id);
    setIsLoggedIn(true);
    await fetchReservations(id);
  };

  const handleCreateReservation = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setErrorMsg('');
    if (selectedSeat === null) {
      setErrorMsg('Please select a seat.');
      return;
    }
    if (!startTime || !endTime) {
      setErrorMsg('Please pick a start and end time.');
      return;
    }
    if (new Date(endTime).getTime() <= new Date(startTime).getTime()) {
      setErrorMsg('End time must be after start time.');
      return;
    }
    if (isSeatBusy(selectedSeat, startTime, endTime)) {
      setErrorMsg('That seat is already taken for this time window.');
      return;
    }
    const seat = SEATS.find((s) => s.seat === selectedSeat);
    if (!seat) {
      setErrorMsg('Unknown seat.');
      return;
    }

    const reserved_for = new Date(startTime).toISOString();
    const end_time = new Date(endTime).toISOString();

    const { error } = await supabase.from('requests').insert({
      seat_number: selectedSeat,
      x_coord: seat.x,
      y_coord: seat.y,
      taken: true,
      user_id: utid,
      reserved_for,
      end_time,
    });

    if (error) {
      setErrorMsg(error.message);
      return;
    }

    closeReservationModal();
    await fetchReservations(utid);
  };

  const handleCheckIn = async (reservation: Reservation) => {
    setCheckin({ phase: 'navigating', reservation });
    try {
      await sendNavGoal(reservation.id, async (result: NavResult) => {
        if (result === 'succeeded') {
          await supabase
            .from('requests')
            .update({ checked_in: true })
            .eq('id', reservation.id);
          setCheckin({ phase: 'arrived', reservation });
        } else {
          setCheckin({ phase: 'failed', reservation, reason: result });
        }
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : 'Could not reach robot';
      setCheckin({ phase: 'failed', reservation, reason: msg });
    }
  };

  const handleDoneCheckin = async () => {
    setCheckin({ phase: 'idle' });
    await fetchReservations(utid);
  };

  const handleRemoveReservation = async (reservation: Reservation) => {
    const ok = window.confirm(
      `Remove reservation for seat ${reservation.seat_number} on ${formatDateTime(reservation.reserved_for)}?`,
    );
    if (!ok) return;
    setErrorMsg('');
    const { data, error } = await supabase
      .from('requests')
      .delete()
      .eq('id', reservation.id)
      .select();
    if (error) {
      setErrorMsg(error.message);
      return;
    }
    if (!data || data.length === 0) {
      setErrorMsg(
        "Couldn't remove — Supabase blocked the delete. Add a DELETE row-level-security policy on the `requests` table.",
      );
      return;
    }
    await fetchReservations(utid);
  };

  // ---------- Login ----------
  if (!isLoggedIn) {
    return (
      <div className="min-h-screen bg-white flex items-center justify-center px-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-10">
            <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-blue-600 mb-5">
              <span className="text-white text-2xl font-bold">U</span>
            </div>
            <h1 className="text-3xl font-semibold text-gray-900 mb-2">UsherBot</h1>
            <p className="text-gray-500">Sign in with your UT ID to continue</p>
          </div>

          <form onSubmit={handleLogin} className="space-y-4">
            <div>
              <label htmlFor="utid" className="block text-sm font-medium text-gray-700 mb-2">
                UT ID
              </label>
              <input
                type="text"
                id="utid"
                name="utid"
                placeholder="e.g. jsl3775"
                required
                autoFocus
                className="w-full px-4 py-3 border border-gray-200 rounded-xl text-gray-900 placeholder-gray-400 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-50"
              />
            </div>
            <button
              type="submit"
              className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 active:bg-blue-800 text-white font-medium rounded-xl transition shadow-sm"
            >
              Continue
            </button>
          </form>
        </div>
      </div>
    );
  }

  // ---------- Check-in flow ----------
  if (checkin.phase === 'navigating') {
    return (
      <StatusScreen
        icon={<Spinner />}
        title={`Bringing you to seat ${checkin.reservation.seat_number}`}
        subtitle={`(${checkin.reservation.x_coord}, ${checkin.reservation.y_coord})`}
      />
    );
  }

  if (checkin.phase === 'arrived') {
    return (
      <StatusScreen
        icon={<CheckIcon />}
        title="You've reached your seat!"
        subtitle={`Seat ${checkin.reservation.seat_number}`}
        action={
          <button
            onClick={handleDoneCheckin}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-sm"
          >
            Done
          </button>
        }
      />
    );
  }

  if (checkin.phase === 'failed') {
    return (
      <StatusScreen
        icon={<ErrorIcon />}
        title="Couldn't reach your seat"
        subtitle={checkin.reason}
        action={
          <button
            onClick={handleDoneCheckin}
            className="px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-sm"
          >
            Back
          </button>
        }
      />
    );
  }

  // ---------- Home ----------
  return (
    <div className="min-h-screen bg-gray-50">
      <nav className="bg-white border-b border-gray-100">
        <div className="max-w-5xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="inline-flex items-center justify-center w-8 h-8 rounded-lg bg-blue-600">
              <span className="text-white text-sm font-bold">U</span>
            </div>
            <span className="font-semibold text-gray-900">UsherBot</span>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-sm text-gray-500 hidden sm:inline">{utid}</span>
            <button
              onClick={openReservationModal}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition shadow-sm"
            >
              + New Reservation
            </button>
          </div>
        </div>
      </nav>

      <main className="max-w-5xl mx-auto px-6 py-10">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold text-gray-900 mb-1">
            Welcome back, <span className="text-blue-600">{utid}</span>
          </h1>
          <p className="text-gray-500">Your reservations</p>
        </div>

        {errorMsg && (
          <div className="mb-6 p-4 bg-red-50 border border-red-100 text-red-700 rounded-xl text-sm">
            {errorMsg}
          </div>
        )}

        {loading ? (
          <div className="text-gray-400 text-sm">Loading...</div>
        ) : current.length === 0 && upcoming.length === 0 ? (
          <div className="p-12 bg-white border border-gray-100 rounded-2xl text-center">
            <p className="text-gray-500 mb-4">No reservations yet.</p>
            <button
              onClick={openReservationModal}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition shadow-sm"
            >
              Make a Reservation
            </button>
          </div>
        ) : (
          <div className="space-y-10">
            {current.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <span className="inline-flex w-2 h-2 rounded-full bg-blue-600 animate-pulse" />
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                    Ready to check in
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {current.map((r) => (
                    <div
                      key={r.id}
                      className="p-6 bg-white border-2 border-blue-600 rounded-2xl shadow-sm"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs uppercase tracking-wide text-gray-400 font-medium">
                          Seat
                        </span>
                        <span className="text-xs text-white bg-blue-600 px-2 py-1 rounded-md font-medium">
                          NOW
                        </span>
                      </div>
                      <div className="text-4xl font-semibold text-gray-900 mb-1">
                        {r.seat_number}
                      </div>
                      <div className="text-sm text-gray-500 mb-1">
                        {formatDateTime(r.reserved_for)}
                      </div>
                      <div className="text-xs text-gray-400 mb-6 font-mono">
                        ({r.x_coord}, {r.y_coord})
                      </div>
                      <button
                        onClick={() => handleCheckIn(r)}
                        className="w-full px-4 py-2.5 bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium rounded-lg transition shadow-sm"
                      >
                        Check In
                      </button>
                      <button
                        onClick={() => handleRemoveReservation(r)}
                        className="mt-2 w-full px-4 py-2.5 bg-white border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 text-sm font-medium rounded-lg transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}

            {upcoming.length > 0 && (
              <section>
                <div className="flex items-center gap-2 mb-4">
                  <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-700">
                    Upcoming
                  </h2>
                </div>
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {upcoming.map((r) => (
                    <div
                      key={r.id}
                      className="p-6 bg-white border border-gray-100 rounded-2xl hover:border-blue-200 transition"
                    >
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-xs uppercase tracking-wide text-gray-400 font-medium">
                          Seat
                        </span>
                        <span className="text-xs text-blue-600 bg-blue-50 px-2 py-1 rounded-md font-medium">
                          Upcoming
                        </span>
                      </div>
                      <div className="text-4xl font-semibold text-gray-900 mb-1">
                        {r.seat_number}
                      </div>
                      <div className="text-sm text-gray-700 font-medium mb-1">
                        {formatDateTime(r.reserved_for)}
                      </div>
                      <div className="text-xs text-gray-400 mb-6 font-mono">
                        ({r.x_coord}, {r.y_coord})
                      </div>
                      <button
                        disabled
                        className="w-full px-4 py-2.5 bg-gray-100 text-gray-400 text-sm font-medium rounded-lg cursor-not-allowed"
                      >
                        Available 15 min before
                      </button>
                      <button
                        onClick={() => handleRemoveReservation(r)}
                        className="mt-2 w-full px-4 py-2.5 bg-white border border-gray-200 text-gray-600 hover:text-red-600 hover:border-red-200 text-sm font-medium rounded-lg transition"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              </section>
            )}
          </div>
        )}
      </main>

      {showReservation && (
        <>
          <div
            className="fixed inset-0 bg-gray-900/40 z-40"
            onClick={closeReservationModal}
          />
          <div className="fixed inset-0 flex items-end sm:items-center justify-center z-50 p-0 sm:p-4">
            <div className="w-full sm:max-w-md bg-white rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-8 max-h-[92vh] overflow-y-auto">
              <div className="flex justify-between items-center mb-5 sm:mb-6">
                <h2 className="text-xl font-semibold text-gray-900">New Reservation</h2>
                <button
                  onClick={closeReservationModal}
                  className="text-gray-400 hover:text-gray-700 text-3xl leading-none w-10 h-10 flex items-center justify-center -mr-2"
                  aria-label="Close"
                >
                  ×
                </button>
              </div>
              <form onSubmit={handleCreateReservation} className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 sm:gap-4">
                  <div>
                    <label htmlFor="start_time" className="block text-sm font-medium text-gray-700 mb-2">
                      Start Time
                    </label>
                    <input
                      type="datetime-local"
                      id="start_time"
                      value={startTime}
                      onChange={(e) => onStartTimeChange(e.target.value)}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base text-gray-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-50"
                    />
                  </div>
                  <div>
                    <label htmlFor="end_time" className="block text-sm font-medium text-gray-700 mb-2">
                      End Time
                    </label>
                    <input
                      type="datetime-local"
                      id="end_time"
                      value={endTime}
                      onChange={(e) => onEndTimeChange(e.target.value)}
                      required
                      className="w-full px-4 py-3 border border-gray-200 rounded-xl text-base text-gray-900 outline-none transition focus:border-blue-600 focus:ring-4 focus:ring-blue-50"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-2">
                    Select a Seat
                  </label>
                  <div className="p-3 sm:p-4 bg-gray-50 border border-gray-200 rounded-xl space-y-2">
                    {[1, 2].map((row) => (
                      <div key={row} className="grid grid-cols-3 gap-2">
                        {SEATS.filter((s) => s.row === row).map((s) => {
                          const isSelected = selectedSeat === s.seat;
                          const busy = isSeatBusy(s.seat, startTime, endTime);
                          return (
                            <button
                              key={s.seat}
                              type="button"
                              disabled={busy}
                              onClick={() => setSelectedSeat(s.seat)}
                              title={busy ? 'Already reserved for this time' : `Seat ${s.seat}`}
                              className={`aspect-square rounded-lg font-semibold text-lg transition border-2 ${
                                busy
                                  ? 'bg-gray-100 border-gray-200 text-gray-400 cursor-not-allowed line-through'
                                  : isSelected
                                  ? 'bg-blue-600 border-blue-600 text-white shadow-sm'
                                  : 'bg-white border-gray-200 text-gray-700 hover:border-blue-300 active:bg-gray-50'
                              }`}
                            >
                              {s.seat}
                            </button>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                  {selectedSeat !== null && (() => {
                    const s = SEATS.find((x) => x.seat === selectedSeat);
                    if (!s) return null;
                    return (
                      <div className="mt-3 px-4 py-3 bg-blue-50 border border-blue-100 rounded-xl">
                        <p className="text-xs uppercase tracking-wide text-blue-600 font-semibold mb-1">
                          Seat {s.seat}
                        </p>
                        <p className="text-sm text-gray-700 font-mono">
                          x = {s.x.toFixed(3)}, y = {s.y.toFixed(3)}
                        </p>
                      </div>
                    );
                  })()}
                </div>
                <button
                  type="submit"
                  className="w-full px-4 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-xl transition shadow-sm"
                >
                  Create Reservation
                </button>
              </form>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatusScreen({
  icon,
  title,
  subtitle,
  action,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="min-h-screen bg-white flex items-center justify-center px-4">
      <div className="text-center max-w-md">
        <div className="flex justify-center mb-6">{icon}</div>
        <h1 className="text-2xl font-semibold text-gray-900 mb-2">{title}</h1>
        {subtitle && <p className="text-gray-500 mb-8">{subtitle}</p>}
        {action}
      </div>
    </div>
  );
}

function Spinner() {
  return (
    <div className="w-14 h-14 border-4 border-blue-100 border-t-blue-600 rounded-full animate-spin" />
  );
}

function CheckIcon() {
  return (
    <div className="w-14 h-14 rounded-full bg-blue-600 flex items-center justify-center">
      <svg className="w-7 h-7 text-white" fill="none" stroke="currentColor" strokeWidth="3" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
      </svg>
    </div>
  );
}

function ErrorIcon() {
  return (
    <div className="w-14 h-14 rounded-full bg-red-50 flex items-center justify-center">
      <svg className="w-7 h-7 text-red-600" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v4m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
      </svg>
    </div>
  );
}