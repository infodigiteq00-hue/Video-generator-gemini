// Festival calendar for the landing page: the nearest big festival is suggested, the rest are in the dropdown.
// Lunar festivals move every year, so each has its own date. Add the next year's dates before this list runs out.
// `region`: 'in' = shown to users in India, 'world' = shown to everyone.

export interface Festival {
  name: string;
  date: string; // YYYY-MM-DD
  region: 'in' | 'world';
  /** Big enough to be suggested first; smaller ones are only in the dropdown. */
  major?: boolean;
}

const F = (name: string, date: string, region: Festival['region'], major = false): Festival => ({ name, date, region, major });

export const FESTIVALS: Festival[] = [
  F('Halloween', '2026-10-31', 'world'),
  F('Dhanteras', '2026-11-06', 'in'),
  F('Diwali', '2026-11-08', 'in', true),
  F('Govardhan Puja', '2026-11-10', 'in'),
  F('Hindu New Year', '2026-11-10', 'in'),
  F('Labh Pancham', '2026-11-14', 'in'),
  F('Bhai Dooj', '2026-11-11', 'in'),
  F('Chhath Puja', '2026-11-15', 'in'),
  F('Guru Nanak Jayanti', '2026-11-24', 'in', true),
  F('Thanksgiving', '2026-11-26', 'world', true),
  F('Hanukkah', '2026-12-05', 'world'),
  F('Christmas', '2026-12-25', 'world', true),
  F('New Year', '2027-01-01', 'world', true),
  F('Lohri', '2027-01-13', 'in'),
  F('Makar Sankranti', '2027-01-14', 'in', true),
  F('Pongal', '2027-01-15', 'in'),
  F('Republic Day', '2027-01-26', 'in', true),
  F('Chinese New Year', '2027-02-06', 'world', true),
  F('Vasant Panchami', '2027-02-11', 'in'),
  F('Valentine’s Day', '2027-02-14', 'world'),
  F('Maha Shivratri', '2027-03-06', 'in', true),
  F('Eid al-Fitr', '2027-03-10', 'world', true),
  F('Holi', '2027-03-22', 'in', true),
  F('Easter', '2027-03-28', 'world', true),
  F('Gudi Padwa', '2027-04-07', 'in'),
  F('Ugadi', '2027-04-07', 'in'),
  F('Baisakhi', '2027-04-14', 'in'),
  F('Ram Navami', '2027-04-15', 'in', true),
  F('Akshaya Tritiya', '2027-05-09', 'in'),
  F('Buddha Purnima', '2027-05-20', 'in'),
  F('Eid al-Adha', '2027-05-17', 'world', true),
  F('Independence Day', '2027-08-15', 'in', true),
  F('Raksha Bandhan', '2027-08-17', 'in', true),
  F('Janmashtami', '2027-08-25', 'in', true),
  F('Onam', '2027-09-12', 'in'),
  F('Ganesh Chaturthi', '2027-09-04', 'in', true),
  F('Navratri', '2027-09-30', 'in', true),
  F('Durga Puja', '2027-10-06', 'in', true),
  F('Dussehra', '2027-10-09', 'in', true),
  F('Karva Chauth', '2027-10-18', 'in'),
  F('Halloween', '2027-10-31', 'world'),
  F('Dhanteras', '2027-10-27', 'in'),
  F('Diwali', '2027-10-29', 'in', true),
  F('Hindu New Year', '2027-10-30', 'in'),
  F('Bhai Dooj', '2027-10-31', 'in'),
  F('Labh Pancham', '2027-11-03', 'in'),
  F('Christmas', '2027-12-25', 'world', true),
].sort((a, b) => a.date.localeCompare(b.date));

/** India by the device's time zone; everyone else gets the worldwide festivals. */
export function inIndia() {
  try {
    return /^Asia\/(Kolkata|Calcutta)$/.test(Intl.DateTimeFormat().resolvedOptions().timeZone);
  } catch {
    return false;
  }
}

/** Festivals from today on for this user, nearest first; `suggested` is the nearest major one. */
export function upcoming(today = new Date()) {
  const day = today.toLocaleDateString('en-CA'); // YYYY-MM-DD in local time
  const india = inIndia();
  const list = FESTIVALS.filter((f) => f.date >= day && (india || f.region === 'world'));
  return { list, suggested: list.find((f) => f.major) ?? list[0] ?? null };
}

/** The next date of a festival by name (pack festivals are always in India's calendar). */
export const nextDate = (name: string, today = new Date()) =>
  FESTIVALS.find((f) => f.name === name && f.date >= today.toLocaleDateString('en-CA')) ?? null;

/** "Today", "Tomorrow", "In 8 days · 8 Nov" */
export function when(f: Festival, today = new Date()) {
  const date = new Date(`${f.date}T00:00:00`);
  const days = Math.round((date.getTime() - new Date(today.toDateString()).getTime()) / 86400000);
  const label = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' });
  return days === 0 ? 'Today' : days === 1 ? 'Tomorrow' : `In ${days} days · ${label}`;
}
