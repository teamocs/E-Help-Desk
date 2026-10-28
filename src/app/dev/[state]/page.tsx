import { notFound } from "next/navigation";
import { Account, type AccountData } from "../../dashboard/Account";

// Development only: every state of the account page from fixture data, so each role can be looked at
// without signing in. In a production build this route is a 404.

const team = [
  { email: "owner@azalea.example", role: "owner", claimed: true },
  { email: "maria.manager@azalea.example", role: "manager", claimed: true },
  { email: "frontdesk@azalea.example", role: "device", claimed: true },
  { email: "new.manager.with.a.very.long.address.for.testing@azalea-hotels.example", role: "manager", claimed: false },
];
const staff = [
  { dept: "frontdesk", n: 3 },
  { dept: "housekeeping", n: 8 },
  { dept: "engineering", n: 2 },
  { dept: null, n: 1 },
];
const summary = [
  { id: "p1", name: "Azalea Boracay", open: 14, overdue: 3, workOrders: 2, incidents: 0 },
  { id: "p2", name: "Azalea Baguio", open: 0, overdue: 0, workOrders: 0, incidents: 1 },
];

const STATES: Record<string, AccountData> = {
  owner: { kind: "member", email: "owner@azalea.example", role: "owner", hotel: "Azalea Hotels", summary, staff, team },
  manager: { kind: "member", email: "maria.manager@azalea.example", role: "manager", hotel: "Azalea Hotels", summary: summary.slice(0, 1), staff, team },
  device: { kind: "member", email: "frontdesk@azalea.example", role: "device", hotel: "Azalea Hotels", summary: [], staff, team: [] },
  empty: { kind: "member", email: "owner@newhotel.example", role: "owner", hotel: "New Hotel", summary: [{ id: "p3", name: "Main", open: 0, overdue: 0, workOrders: 0, incidents: 0 }], staff: [], team: [{ email: "owner@newhotel.example", role: "owner", claimed: true }] },
  unverified: { kind: "unverified", email: "new.person@example.com" },
  "no-hotel": { kind: "no-hotel", email: "new.person@example.com" },
};

export function generateStaticParams() {
  return Object.keys(STATES).map((state) => ({ state }));
}

export default async function Preview({ params }: { params: Promise<{ state: string }> }) {
  if (process.env.NODE_ENV === "production") notFound();
  const { state } = await params;
  const data = STATES[state];
  if (!data) notFound();
  return <Account data={data} />;
}
