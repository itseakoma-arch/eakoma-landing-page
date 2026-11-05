// Zero-config Vercel Serverless Function for 24-Hour Private Artist Analytics
// Automatically persists events across warm instances and supports Vercel KV (Upstash) if linked.

const globalStore = globalThis.__ARTIST_ANALYTICS_STORE__ || {
  events: []
};
globalThis.__ARTIST_ANALYTICS_STORE__ = globalStore;

const MAX_RETENTION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

async function kvPushEvent(eventObj) {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return false;
  try {
    await fetch(`${url}/lpush/artist_analytics_events`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(eventObj)
    });
    await fetch(`${url}/ltrim/artist_analytics_events/0/4999`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` }
    });
    return true;
  } catch (e) {
    return false;
  }
}

async function kvLoadEvents() {
  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;
  if (!url || !token) return null;
  try {
    const res = await fetch(`${url}/lrange/artist_analytics_events/0/2000`, {
      headers: { Authorization: `Bearer ${token}` }
    });
    if (!res.ok) return null;
    const data = await res.json();
    if (!Array.isArray(data.result)) return null;
    return data.result
      .map((item) => {
        try {
          return typeof item === 'string' ? JSON.parse(item) : item;
        } catch (e) {
          return null;
        }
      })
      .filter(Boolean);
  } catch (e) {
    return null;
  }
}

module.exports = async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  const now = Date.now();
  globalStore.events = globalStore.events.filter((ev) => ev && ev.ts >= now - MAX_RETENTION_MS);

  if (req.method === 'POST') {
    try {
      const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      if (body && body.type) {
        const cleanEvent = {
          id: String(body.id || `ev_${now}_${Math.random().toString(36).slice(2, 7)}`),
          type: body.type === 'click' ? 'click' : 'pageview',
          linkId: String(body.linkId || 'page').slice(0, 64),
          linkName: String(body.linkName || 'Page Visit').slice(0, 120),
          ts: Number(body.ts) || now,
          visitorId: String(body.visitorId || 'anon').slice(0, 64),
          device: String(body.device || 'Web').slice(0, 32)
        };
        globalStore.events.push(cleanEvent);
        await kvPushEvent(cleanEvent);
      }
      return res.status(200).json({ ok: true });
    } catch (err) {
      return res.status(400).json({ ok: false });
    }
  }

  if (req.method === 'GET') {
    const kvEvents = await kvLoadEvents();
    const allEvents = kvEvents || globalStore.events;
    return res.status(200).json({
      ok: true,
      now,
      events: allEvents
    });
  }

  return res.status(405).json({ error: 'Method not allowed' });
};
