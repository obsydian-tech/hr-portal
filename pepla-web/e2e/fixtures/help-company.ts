/**
 * The ONE company that appears in help pictures and walkthrough videos.
 *
 * Everything here is made up. It is public (the repo is public), so never put
 * a real person, company, ID number, bank account or phone number here.
 * South African by default (day zero is South Africa only).
 *
 * When journeys run against pepla-dev, the dev seed creates this same company
 * and these same people, so names and counts never change between retakes.
 */
export const HELP_COMPANY = {
  name: 'Sunbird Bakery (Pty) Ltd',
  shortName: 'Sunbird Bakery',
  city: 'Gqeberha',
  country: 'ZA',
  currency: 'ZAR',
} as const;

export type HelpRole = 'Admin' | 'HR' | 'Manager' | 'Employee';

/** Fake people. Emails use example.com, which can never receive mail. */
export const HELP_PEOPLE = [
  { key: 'admin', name: 'Nomsa Dlamini', role: 'Admin', title: 'Owner', email: 'nomsa@example.com' },
  { key: 'hr', name: 'Pieter van Wyk', role: 'HR', title: 'People and payroll', email: 'pieter@example.com' },
  { key: 'manager', name: 'Ayesha Patel', role: 'Manager', title: 'Head baker', email: 'ayesha@example.com' },
  { key: 'employee', name: 'Sipho Mokoena', role: 'Employee', title: 'Baker', email: 'sipho@example.com' },
  { key: 'employee2', name: 'Lerato Nkosi', role: 'Employee', title: 'Shop assistant', email: 'lerato@example.com' },
  { key: 'employee3', name: 'Johan Botha', role: 'Employee', title: 'Delivery driver', email: 'johan@example.com' },
  { key: 'new', name: 'Thandi Mahlangu', role: 'Employee', title: 'Junior baker (starting soon)', email: 'thandi@example.com' },
] as const satisfies ReadonlyArray<{ key: string; name: string; role: HelpRole; title: string; email: string }>;
