// Reads _data/ne115.yml (the 115 peaks) and _data/ne115-hikes.yml (the hikes I've done), and works out
// from the hikes which peaks are hiked and which were only attempted.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parse } from 'yaml';
import { z } from 'astro/zod';

const peakSchema = z.object({
  name: z.string(),
  state: z.enum(['NH', 'ME', 'VT', 'NY']),
  list: z.enum(['New Hampshire 48', 'Adirondack 46', 'Maine 14', 'Vermont 5', 'Catskills 2']),
  range: z.string(),
  park: z.string(),
  /** Summit, in feet */
  elevation: z.number(),
  /** A standard route, for comparison. What I actually hiked is in the hike log. */
  route: z.string(),
  /** Standard route, round trip */
  miles: z.number(),
  /** Standard route, feet of climbing */
  gain: z.number(),
  trail: z.enum(['marked', 'unmarked']),
  also: z.string().optional(),
  lat: z.number().min(40).max(48),
  lon: z.number().min(-76).max(-66),
});

// YAML reads a bare date as a Date, so take either and keep it as YYYY-MM-DD
const day = z.coerce.date().transform((d) => d.toISOString().slice(0, 10));

const hikeSchema = z.object({
  date: day,
  /** A name for the outing, if it helps */
  title: z.string().optional(),
  /** The route I took, which may not be the standard one */
  route: z.string(),
  miles: z.number().optional(),
  gain: z.number().optional(),
  /** Peaks I reached the summit of on this hike */
  summited: z.array(z.string()).default([]),
  /** Peaks I set out for and didn't reach */
  attempted: z.array(z.string()).default([]),
  notes: z.string().optional(),
});

export type Hike = z.infer<typeof hikeSchema>;
export type Status = 'hiked' | 'attempted' | 'to-hike';

export type Peak = z.infer<typeof peakSchema> & {
  status: Status;
  /** When I first summited it, or first attempted it if I haven't yet */
  date?: string;
  /** Other peaks I summited on the same hike */
  with: string[];
};

export const PEAK_COUNT = 115;

const readYaml = async (file: string) => parse(await readFile(join(process.cwd(), '_data', file), 'utf8'));

export async function loadNE115(): Promise<{ peaks: Peak[]; hikes: Hike[] }> {
  const base = z.array(peakSchema).parse(await readYaml('ne115.yml'));
  if (base.length !== PEAK_COUNT) throw new Error(`ne115.yml has ${base.length} peaks, and the list has ${PEAK_COUNT}`);
  const names = new Set(base.map((p) => p.name));
  if (names.size !== base.length) throw new Error('ne115.yml lists a peak twice');

  // A file of only comments parses to nothing
  const hikes = z
    .array(hikeSchema)
    .parse((await readYaml('ne115-hikes.yml')) ?? [])
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const hike of hikes) {
    const where = `ne115-hikes.yml, ${hike.date} ${hike.title ?? hike.route}`;
    if (!hike.summited.length && !hike.attempted.length) throw new Error(`${where}: list a peak under summited or attempted`);
    for (const name of [...hike.summited, ...hike.attempted]) {
      if (!names.has(name)) throw new Error(`${where}: "${name}" isn't a peak in ne115.yml (names are spelled as in that file)`);
    }
    for (const name of hike.summited) {
      if (hike.attempted.includes(name)) throw new Error(`${where}: "${name}" is both summited and attempted`);
    }
  }

  // Hikes are in date order, so the first one that mentions a peak is its earliest
  const peaks = base.map((peak): Peak => {
    const summit = hikes.find((h) => h.summited.includes(peak.name));
    if (summit) {
      return { ...peak, status: 'hiked', date: summit.date, with: summit.summited.filter((n) => n !== peak.name) };
    }
    const attempt = hikes.find((h) => h.attempted.includes(peak.name));
    if (attempt) return { ...peak, status: 'attempted', date: attempt.date, with: [] };
    return { ...peak, status: 'to-hike', with: [] };
  });
  return { peaks, hikes };
}
