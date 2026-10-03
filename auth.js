// Discord OAuth2 login for admins. Sessions are stateless signed cookies,
// so this works on serverless hosts like Vercel.
const crypto = require('crypto');
const express = require('express');

const CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const CLIENT_SECRET = process.env.DISCORD_CLIENT_SECRET;
const ADMIN_IDS = (process.env.ADMIN_DISCORD_IDS || '')
  .split(',').map((s) => s.trim()).filter(Boolean);
// Must be stable across serverless instances in production.
const SECRET = process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex');
const SESSION_MS = 7 * 24 * 60 * 60 * 1000;

const sign = (value) => crypto.createHmac('sha256', SECRET).update(value).digest('base64url');

function encode(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body)}`;
}

function decode(token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  const expected = Buffer.from(sign(body));
  const given = Buffer.from(sig);
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString());
    return payload.exp > Date.now() ? payload : null;
  } catch {
    return null;
  }
}

function cookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

const isHttps = (req) => (req.headers['x-forwarded-proto'] || req.protocol) === 'https';

function setCookie(req, res, name, value, maxAgeMs) {
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; ` +
    `Max-Age=${Math.floor(maxAgeMs / 1000)}${isHttps(req) ? '; Secure' : ''}`);
}

const redirectUri = (req) => process.env.DISCORD_REDIRECT_URI ||
  `${isHttps(req) ? 'https' : 'http'}://${req.headers.host}/auth/callback`;

/** Returns the logged-in Discord user ({id, name, avatar}) or null. Anyone can log in. */
function getUser(req) {
  const session = decode(cookies(req).session);
  return session ? { id: session.id, name: session.name, avatar: session.avatar } : null;
}

/** Returns the logged-in user only if their Discord ID is on the admin list. */
function getAdmin(req) {
  const user = getUser(req);
  return user && ADMIN_IDS.includes(user.id) ? user : null;
}

function avatarUrl(user) {
  if (user.avatar && /^[a-z0-9_]+$/i.test(user.avatar) && /^\d+$/.test(user.id)) {
    return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
  }
  const index = /^\d+$/.test(user.id) ? Number((BigInt(user.id) >> 22n) % 6n) : 0;
  return `https://cdn.discordapp.com/embed/avatars/${index}.png`;
}

function requireAdmin(req, res, next) {
  if (getAdmin(req)) return next();
  res.status(403).json({ error: 'Admins only.' });
}

const router = express.Router();

router.get('/auth/login', (req, res) => {
  if (!CLIENT_ID || !CLIENT_SECRET) return res.status(503).send('Discord login is not configured.');
  const state = crypto.randomBytes(16).toString('hex');
  setCookie(req, res, 'oauth_state', state, 10 * 60 * 1000);
  const params = new URLSearchParams({
    client_id: CLIENT_ID,
    redirect_uri: redirectUri(req),
    response_type: 'code',
    scope: 'identify',
    state,
  });
  res.redirect(`https://discord.com/oauth2/authorize?${params}`);
});

router.get('/auth/callback', async (req, res) => {
  const { code, state } = req.query;
  if (!code || !state || state !== cookies(req).oauth_state) {
    return res.status(400).send('Invalid login attempt. Please try again.');
  }
  try {
    const tokenRes = await fetch('https://discord.com/api/oauth2/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: CLIENT_ID,
        client_secret: CLIENT_SECRET,
        grant_type: 'authorization_code',
        code: String(code),
        redirect_uri: redirectUri(req),
      }),
    });
    if (!tokenRes.ok) throw new Error(`token exchange ${tokenRes.status}`);
    const { access_token } = await tokenRes.json();
    const userRes = await fetch('https://discord.com/api/users/@me', {
      headers: { Authorization: `Bearer ${access_token}` },
    });
    if (!userRes.ok) throw new Error(`user lookup ${userRes.status}`);
    const user = await userRes.json();
    setCookie(req, res, 'session',
      encode({
        id: user.id,
        name: user.global_name || user.username,
        avatar: user.avatar || null,
        exp: Date.now() + SESSION_MS,
      }),
      SESSION_MS);
    res.redirect('/');
  } catch (err) {
    console.error(err);
    res.status(502).send('Discord login failed. Please try again.');
  }
});

router.post('/auth/logout', (req, res) => {
  setCookie(req, res, 'session', '', 0);
  res.json({ ok: true });
});

router.get('/api/me', (req, res) => {
  const user = getUser(req);
  res.json({
    loggedIn: !!user,
    admin: !!getAdmin(req),
    name: user ? user.name : null,
    avatarUrl: user ? avatarUrl(user) : null,
    loginEnabled: !!(CLIENT_ID && CLIENT_SECRET),
  });
});

module.exports = { router, getAdmin, requireAdmin };
