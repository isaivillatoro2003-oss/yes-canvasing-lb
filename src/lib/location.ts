"use client";

/**
 * Location for work events. The phone is asked only during a work session; the
 * result always comes back (never throws) with a status the leader can see:
 * ok · denied (permission refused) · unavailable (no GPS) · timeout.
 */
export type Loc = {
  status: "ok" | "denied" | "unavailable" | "timeout";
  lat?: number;
  lng?: number;
  accuracy?: number;
  city?: string;
  neighborhood?: string;
};

export function getPosition(timeoutMs = 10000): Promise<Loc> {
  return new Promise((resolve) => {
    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      resolve({ status: "unavailable" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({
        status: "ok",
        lat: Math.round(p.coords.latitude * 1e6) / 1e6,
        lng: Math.round(p.coords.longitude * 1e6) / 1e6,
        accuracy: Math.round(p.coords.accuracy),
      }),
      (err) => resolve({ status: err.code === err.PERMISSION_DENIED ? "denied" : err.code === err.TIMEOUT ? "timeout" : "unavailable" }),
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60000 },
    );
  });
}

type Place = { city?: string; neighborhood?: string };
const CACHE_KEY = "yes:geocode-cache";

function readCache(): Record<string, Place> {
  try { return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}"); } catch { return {}; }
}

/**
 * City / neighborhood from coordinates via OpenStreetMap Nominatim.
 * Results are cached per ~100 m cell so a student walking a street doesn't
 * repeat lookups (and we respect Nominatim's fair-use limits).
 */
export async function reverseGeocode(lat: number, lng: number): Promise<Place> {
  const cell = `${lat.toFixed(3)},${lng.toFixed(3)}`;
  const cache = readCache();
  if (cache[cell]) return cache[cell];
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 6000);
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=16&accept-language=en&lat=${lat}&lon=${lng}`,
      { signal: ctrl.signal, headers: { Accept: "application/json" } },
    );
    clearTimeout(t);
    if (!res.ok) return {};
    const j = (await res.json()) as { address?: Record<string, string> };
    const a = j.address ?? {};
    const place: Place = {
      city: a.city || a.town || a.village || a.municipality || a.county || a.state_district,
      neighborhood: a.neighbourhood || a.suburb || a.quarter || a.city_district || a.hamlet,
    };
    const keys = Object.keys(cache);
    if (keys.length > 300) delete cache[keys[0]];
    cache[cell] = place;
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(cache)); } catch { /* storage full */ }
    return place;
  } catch {
    return {};
  }
}

/** Position + place names, ready to send with a work event. */
export async function currentLocation(timeoutMs = 10000): Promise<Loc> {
  const pos = await getPosition(timeoutMs);
  if (pos.status !== "ok") return pos;
  const place = await reverseGeocode(pos.lat!, pos.lng!);
  return { ...pos, ...place };
}

export function placeLabel(l: { neighborhood?: string | null; city?: string | null } | null | undefined): string {
  return [l?.neighborhood, l?.city].filter(Boolean).join(", ");
}

export function mapsUrl(lat: number | string, lng: number | string): string {
  return `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
}

const EXPLAINED = "yes:location-explained";
export function locationExplained(): boolean {
  try { return localStorage.getItem(EXPLAINED) === "1"; } catch { return false; }
}
export function markLocationExplained() {
  try { localStorage.setItem(EXPLAINED, "1"); } catch { /* private mode */ }
}
