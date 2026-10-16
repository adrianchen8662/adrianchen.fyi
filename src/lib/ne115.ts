// Reads _data/ne115.yml: the Northeast 115 peaks, and which of them have been hiked.
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
  route: z.string(),
  /** Round trip */
  miles: z.number(),
  /** Feet of climbing on that route */
  gain: z.number(),
  trail: z.enum(['marked', 'unmarked']),
  also: z.string().optional(),
  lat: z.number().min(40).max(48),
  lon: z.number().min(-76).max(-66),
  status: z.enum(['hiked', 'to-hike']),
  /** The day it was hiked; YAML reads a bare date as a Date, so take either and keep it as YYYY-MM-DD */
  date: z.coerce.date().transform((d) => d.toISOString().slice(0, 10)).optional(),
});

export type Peak = z.infer<typeof peakSchema>;

export const PEAK_COUNT = 115;

export async function loadPeaks(): Promise<Peak[]> {
  const raw = parse(await readFile(join(process.cwd(), '_data', 'ne115.yml'), 'utf8'));
  const peaks = z.array(peakSchema).parse(raw);
  if (peaks.length !== PEAK_COUNT) throw new Error(`ne115.yml has ${peaks.length} peaks, and the list has ${PEAK_COUNT}`);
  const names = new Set(peaks.map((p) => p.name));
  if (names.size !== peaks.length) throw new Error('ne115.yml lists a peak twice');
  return peaks;
}
