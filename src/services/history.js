import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Music.app only keeps lifetime play counts, so we keep one snapshot per day and diff them.
const HISTORY_PATH =
  process.env.CRATE_HISTORY_PATH || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../data/play-history.json');

const dayKey = (d = new Date()) => d.toLocaleDateString('sv'); // local YYYY-MM-DD

async function loadHistory() {
  try {
    return JSON.parse(await fs.readFile(HISTORY_PATH, 'utf8'));
  } catch {
    return { snapshots: [] };
  }
}

/** Save today's play counts (one snapshot per day; a later sync the same day replaces it). */
export async function recordSnapshot(tracks, now = new Date()) {
  const history = await loadHistory();
  const counts = {};
  for (const t of tracks) if (t.playedCount > 0) counts[t.persistentID] = t.playedCount;
  const date = dayKey(now);
  history.snapshots = [...history.snapshots.filter((s) => s.date !== date), { date, at: now.toISOString(), counts }].sort((a, b) =>
    a.date.localeCompare(b.date)
  );
  await fs.mkdir(path.dirname(HISTORY_PATH), { recursive: true });
  await fs.writeFile(HISTORY_PATH, JSON.stringify(history));
  return history.snapshots.length;
}

export async function lastSnapshotDate() {
  return (await loadHistory()).snapshots.at(-1)?.date || null;
}

/**
 * What you played in the last `days`: current counts minus the newest snapshot at least that old
 * (or the oldest one we have, while history is still young).
 */
export function buildRecap(snapshots, tracks, days, now = new Date()) {
  if (!snapshots.length) return { days, from: null, totalPlays: 0, minutes: 0, topSongs: [], topArtists: [], firstListens: [] };
  const cutoff = dayKey(new Date(now.getTime() - days * 86400000));
  const base = snapshots.filter((s) => s.date <= cutoff).at(-1) || snapshots[0];
  const played = [];
  for (const t of tracks) {
    const before = base.counts[t.persistentID] || 0;
    const plays = (t.playedCount || 0) - before;
    if (plays > 0) played.push({ persistentID: t.persistentID, name: t.name, artist: t.artist, plays, firstListen: before === 0, duration: t.duration || 0 });
  }
  played.sort((a, b) => b.plays - a.plays);
  const artists = new Map();
  for (const p of played) artists.set(p.artist, (artists.get(p.artist) || 0) + p.plays);
  const strip = ({ duration, ...p }) => p;
  return {
    days,
    from: base.date,
    totalPlays: played.reduce((n, p) => n + p.plays, 0),
    minutes: Math.round(played.reduce((n, p) => n + p.plays * p.duration, 0) / 60),
    topSongs: played.slice(0, 10).map(strip),
    topArtists: [...artists].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, plays]) => ({ name, plays })),
    firstListens: played.filter((p) => p.firstListen).slice(0, 5).map(strip)
  };
}

export async function getRecap(tracks, days = 7) {
  const { snapshots } = await loadHistory();
  return { ...buildRecap(snapshots, tracks, days), snapshotCount: snapshots.length, firstSnapshot: snapshots[0]?.date || null };
}
