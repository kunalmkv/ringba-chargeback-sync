// Simple persistent session store for auth cookies
import fs from 'fs/promises';
import path from 'path';

const STORE_DIR = path.join(process.cwd(), 'data');
const STORE_FILE = path.join(STORE_DIR, 'auth_session.json');

export const readSession = async () => {
  try {
    const raw = await fs.readFile(STORE_FILE, 'utf-8');
    const data = JSON.parse(raw);
    return data;
  } catch (e) {
    return null;
  }
};

export const writeSession = async (session) => {
  await fs.mkdir(STORE_DIR, { recursive: true });
  await fs.writeFile(STORE_FILE, JSON.stringify(session, null, 2), 'utf-8');
};

export const isSessionValid = (session) => {
  if (!session) return false;
  if (!session.cookieHeader) return false;
  if (!session.expiresAt) return false;
  const now = Date.now();
  return now < session.expiresAt;
};

export const buildCookieHeaderFromPuppeteer = (cookies) =>
  cookies.map((c) => `${c.name}=${c.value}`).join('; ');

export const createSessionFromCookies = (cookies, ttlMs) => {
  const cookieHeader = buildCookieHeaderFromPuppeteer(cookies);
  return {
    cookieHeader,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
  };
};


