#!/usr/bin/env node
/**
 * Seeds one buyer account and one vendor account (with a real shop, items,
 * and the stall opened) through the real HTTP API, for local manual testing.
 * Requires `docker compose up -d --build` already running in `backend/`
 * with SMTP_USER/SMTP_PASSWORD blank (so OTP codes print to the api
 * container's logs instead of emailing). Prints both logins at the end.
 *
 * Usage: node backend/scripts/seed-demo.mjs
 */
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const BASE = process.env.SEED_BASE_URL ?? "http://localhost";
const BACKEND_DIR = fileURLToPath(new URL("..", import.meta.url));

async function call(method, path, body, token) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      "content-type": "application/json",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${JSON.stringify(json)}`);
  return json;
}

function readOtp(email) {
  const logs = execSync("docker compose logs api", {
    cwd: BACKEND_DIR,
    maxBuffer: 1024 * 1024 * 20,
  }).toString();
  const escaped = email.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(`code for ${escaped} is (\\d{6})`, "g");
  let match;
  let last;
  while ((match = re.exec(logs))) last = match;
  return last?.[1] ?? null;
}

async function waitForOtp(email, { tries = 6, delayMs = 500 } = {}) {
  for (let i = 0; i < tries; i++) {
    const code = readOtp(email);
    if (code) return code;
    await new Promise((r) => setTimeout(r, delayMs));
  }
  throw new Error(`No OTP found in docker logs for ${email} — is docker compose up in backend/?`);
}

async function signupAndVerify(email, password) {
  await call("POST", "/v1/auth/signup", { email, password });
  const code = await waitForOtp(email);
  return call("POST", "/v1/auth/otp/verify", { email, code });
}

const STAMP = Date.now().toString(36);
const BUYER = { email: `buyer-${STAMP}@example.com`, password: "MoltolDemo123!" };
const VENDOR = { email: `vendor-${STAMP}@example.com`, password: "MoltolDemo123!" };

console.log(`Seeding against ${BASE} ...`);

await signupAndVerify(BUYER.email, BUYER.password);
console.log(`Buyer ready: ${BUYER.email}`);

const vendor = await signupAndVerify(VENDOR.email, VENDOR.password);
const shop = await call(
  "POST",
  "/v1/shops/me",
  { name: "Himanshu's Stall", emoji: "🛒", location: { lat: 28.6139, lng: 77.209 } },
  vendor.token,
);

const items = [
  {
    name: "Tomatoes",
    emoji: "🍅",
    sellCents: 4000,
    floorCents: 2800,
    quantity: 25,
    unit: "kg",
    lowStockAt: 3,
  },
  {
    name: "Onions",
    emoji: "🧅",
    sellCents: 3500,
    floorCents: 2200,
    quantity: 30,
    unit: "kg",
    lowStockAt: 3,
  },
  {
    name: "Mangoes",
    emoji: "🥭",
    sellCents: 9000,
    floorCents: 6000,
    quantity: 15,
    unit: "kg",
    lowStockAt: 2,
  },
  {
    name: "Ginger",
    emoji: "🫚",
    sellCents: 12000,
    floorCents: 9000,
    quantity: 8,
    unit: "kg",
    lowStockAt: 1,
  },
  {
    name: "Potatoes",
    emoji: "🥔",
    sellCents: 2500,
    floorCents: 1500,
    quantity: 40,
    unit: "kg",
    lowStockAt: 5,
  },
];
await call("POST", "/v1/shops/me/items/bulk", { items }, vendor.token);
await call("PUT", "/v1/shops/me/status", { open: true }, vendor.token);
console.log(`Vendor ready: ${VENDOR.email} — shop "${shop.name}" with ${items.length} items, open`);

console.log("\n==== Demo logins ====\n");
console.log(`Buyer   email: ${BUYER.email}`);
console.log(`Buyer   password: ${BUYER.password}`);
console.log(`Vendor  email: ${VENDOR.email}`);
console.log(`Vendor  password: ${VENDOR.password}`);
