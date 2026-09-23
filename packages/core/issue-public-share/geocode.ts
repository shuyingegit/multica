/** Reverse-geocode helpers for public-share guest location labels. */

export async function reverseGeocode(lat: number, lon: number): Promise<string | null> {
  // Prefer a China-reachable provider: nominatim.openstreetmap.org is often
  // unreachable from mainland networks, which previously fell back to bare
  // coordinates (「北纬… 东经…」) on the guest share page.
  const fromBigData = await reverseGeocodeBigDataCloud(lat, lon);
  if (fromBigData) return fromBigData;
  const fromNominatim = await reverseGeocodeNominatim(lat, lon);
  if (fromNominatim) return fromNominatim;
  return null;
}

async function reverseGeocodeBigDataCloud(lat: number, lon: number): Promise<string | null> {
  try {
    const url =
      `https://api.bigdatacloud.net/data/reverse-geocode-client` +
      `?latitude=${lat}&longitude=${lon}&localityLanguage=zh`;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as {
      countryCode?: string;
      principalSubdivision?: string;
      city?: string;
      locality?: string;
    };
    return formatZhAdminAreas({
      province: data.principalSubdivision,
      city: data.city,
      district: data.locality,
      countryCode: data.countryCode,
    });
  } catch {
    return null;
  }
}

async function reverseGeocodeNominatim(lat: number, lon: number): Promise<string | null> {
  try {
    const url =
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2` +
      `&lat=${lat}&lon=${lon}&zoom=14&addressdetails=1`;
    const res = await fetch(url, {
      headers: { Accept: "application/json", "Accept-Language": "zh-CN,zh;q=0.9" },
    });
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: Record<string, string> };
    const a = data.address ?? {};
    return formatZhAdminAreas({
      province: a.state || a.province,
      city: a.city || a.town || a.county,
      district: a.suburb || a.district || a.city_district || a.borough,
      road: a.road || a.neighbourhood || a.village,
      countryCode: a.country_code,
    });
  } catch {
    return null;
  }
}

/** Build「省·市·区」; accept province+city without a road. */
export function formatZhAdminAreas(parts: {
  province?: string;
  city?: string;
  district?: string;
  road?: string;
  countryCode?: string;
}): string | null {
  const clean = (value?: string) => (value ?? "").trim();
  const province = clean(parts.province);
  let city = clean(parts.city);
  let district = clean(parts.district);
  const road = clean(parts.road);
  if (city && province && city === province) city = "";
  if (district && (district === city || district === province)) district = "";
  const chain = [province, city, district].filter(Boolean);
  if (chain.length >= 2) return chain.join("·");
  if (chain.length === 1 && road) return `${chain[0]}·${road}`;
  if (chain.length === 1 && parts.countryCode?.toUpperCase() === "CN") return chain[0]!;
  if (city && road) return `${city}·${road}`;
  return null;
}

export function formatCoords(lat: number, lon: number): string {
  const ns = lat >= 0 ? "北纬" : "南纬";
  const ew = lon >= 0 ? "东经" : "西经";
  return `${ns}${Math.abs(lat).toFixed(3)} ${ew}${Math.abs(lon).toFixed(3)}`;
}

const COORDS_LOCATION_RE =
  /^(北纬|南纬)(\d+(?:\.\d+)?)\s+(东经|西经)(\d+(?:\.\d+)?)$/;

export function parseStoredCoords(label: string): { lat: number; lon: number } | null {
  const m = COORDS_LOCATION_RE.exec(label.trim());
  if (!m) return null;
  const lat = Number(m[2]) * (m[1] === "南纬" ? -1 : 1);
  const lon = Number(m[4]) * (m[3] === "西经" ? -1 : 1);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;
  return { lat, lon };
}

/** Replace a stored「北纬… 东经…」guest location with a place name when possible. */
export async function resolveGuestLocationLabel(label: string): Promise<string> {
  const coords = parseStoredCoords(label);
  if (!coords) return label;
  return (await reverseGeocode(coords.lat, coords.lon)) || label;
}
