// Configuration sample server extension (see README.md here). Mirrors azalea-ehelpdesk/includes/Catalog.php (the module
// lists and catalog.defs) and includes/Profile.php (GET and PUT /profile). The module lists' seeds equal the PHP ones.
import { BUILTIN_DEFS } from "../../src/domain/catalog.ts";

const plain = (labels) => labels.map((label) => ({ label }));
const keyOf = (label, taken) => {
  const base = (label.toLowerCase().normalize("NFD").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "") || "item").slice(0, 20);
  let key = base;
  for (let n = 2; key.length < 2 || taken.has(key); n++) key = base.slice(0, 20 - `_${n}`.length).replace(/_+$/, "") + `_${n}`;
  taken.add(key);
  return key;
};
const CODES = [["10-9", "Medical Emergency"], ["10-28", "Guest Complaint", true], ["10-1", "Fire"], ["10-2", "Earthquake"], ["10-3", "Typhoon"], ["10-4", "Bomb Threat"], ["10-5", "Power Outage"], ["10-6", "Water Interruption"], ["10-7", "Security Threat"], ["10-8", "Civil Disturbance"], ["10-0", "Other"]];
const PLACES = ["Room", "Lobby", "Restaurant", "Pool Area", "Gym / Fitness Center", "Parking Area", "Elevator", "Hallway / Corridor", "Reception / Front Desk", "Back Office", "Kitchen", "Laundry", "Staff Area", "Function Room", "Garden / Outdoor", "Other"];

/** key => [module, title, help, noun, maxItems, fields, seed, usedBy?] */
const LISTS = {
  woAreas: ["workorders", "Areas", "Where a work order is: a room, a public area, the staff house.", ["area", "areas"], 40, [], plain(["Room", "Public Area", "Office", "Staff House", "Function Room", "Basement Parking", "Drivers Quarters", "Other"])],
  cleaningTypes: ["cleaning", "Cleaning types", "The kinds of clean a room attendant logs, like Regular or Checkout.", ["cleaning type", "cleaning types"], 30, [], plain(["Regular", "Checkout", "Deep Clean", "Touch-up", "Pre-arrival", "VIP Setup", "Turndown"]), ["cleaning task", "cleaning tasks"]],
  vehicles: ["transport", "Vehicles", "The hotel cars and vans that trips are logged for.", ["vehicle", "vehicles"], 30, [], plain(["Van 1", "Van 2", "Shuttle"]), ["trip", "trips"]],
  crisisCodes: ["crisis", "Crisis codes", "The radio codes a crisis case is logged under. Mark the guest-complaint code so it asks for a category.", ["radio code", "radio codes"], 30,
    [{ name: "code", label: "radio code", type: "text", max: 8, required: true }, { name: "complaint", label: "guest complaint", type: "bool", default: false }],
    CODES.map(([code, label, complaint]) => ({ label, code, complaint: complaint ?? false })), ["crisis case", "crisis cases"]],
  complaintCategories: ["crisis", "Complaint categories", "What a guest complaint is about, for the complaint code.", ["complaint category", "complaint categories"], 30, [], plain(["Room Condition", "Noise", "Cleanliness", "Food Quality", "Service Attitude", "Billing", "Amenities", "AC / Temperature", "WiFi / Internet", "Wait Time", "Other"]), ["crisis case", "crisis cases"]],
  crisisLocations: ["crisis", "Crisis locations", "Where a crisis happened. A follow-up question asks for the room number or the place.", ["crisis location", "crisis locations"], 40,
    [{ name: "detail", label: "follow-up question", type: "text", max: 20 }], PLACES.map((p) => ({ label: p, detail: p === "Room" ? "Room No." : p === "Other" ? "Specify" : "" })), ["crisis case", "crisis cases"]],
  involvedTypes: ["crisis", "Involved types", "Who was involved in a crisis case: a guest, a supplier, staff.", ["involved type", "involved types"], 20, [], plain(["In-house Guest", "Non-guest", "Restaurant Guest", "Supplier", "Staff"]), ["crisis case", "crisis cases"]],
};

let profile = null;

export default {
  id: "config",
  /** The hotel's lists gain the module lists (seeded like the plugin) and their definitions. */
  catalog(cat) {
    const out = { ...cat, defs: [...BUILTIN_DEFS] };
    for (const [key, [module, label, help, noun, maxItems, fields, seed, usedBy]] of Object.entries(LISTS)) {
      const taken = new Set();
      out[key] ??= seed.map((x) => ({ key: keyOf(x.label, taken), ...x, active: true }));
      out.defs.push({ key, label, noun, help, maxItems, fields, module, ...(usedBy ? { usedBy } : {}) });
    }
    return out;
  },
  /** usage.lists: the cleaning tasks in the sample data use their type's key. */
  usage: ({ db }) => {
    const n = {};
    for (const t of db.cleaning ?? []) n[t.type] = (n[t.type] ?? 0) + 1;
    return { cleaningTypes: n };
  },
  routes: {
    "GET /profile": (url, x) => ({ ok: true, profile: (profile ??= { name: x.hotel ?? "Azalea Baguio", short: "", contact: "", address: "", timeZone: "Asia/Manila" }) }),
    "PUT /profile": async (url, x) => {
      if (x.role !== "owner") return { status: 403, data: { code: "rest_forbidden", message: "Sorry, you are not allowed to do that." } };
      const b = await x.body();
      const max = { name: 80, short: 20, contact: 120, address: 200 }, label = { name: "hotel name", short: "short name", contact: "contact", address: "address" };
      const next = {};
      for (const k of Object.keys(max)) {
        const v = b?.[k] ?? "";
        if (typeof v !== "string") return { status: 400, data: { ok: false, field: k, error: `Enter the ${label[k]} as text.` } };
        next[k] = v.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
        if (k === "name" && !next[k]) return { status: 400, data: { ok: false, field: k, error: "Enter the hotel name." } };
        if (next[k].length > max[k]) return { status: 400, data: { ok: false, field: k, error: `Keep the ${label[k]} to ${max[k]} characters.` } };
      }
      profile = { ...next, timeZone: "Asia/Manila" };
      return { ok: true, profile };
    },
  },
};
