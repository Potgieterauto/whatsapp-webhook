const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');
const sqlite3 = require('sqlite3').verbose();

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Potgieterauto';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const WABA_ID = process.env.WABA_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

// --- BULLETPROOF LOCAL SQLITE DATABASE SETUP ---
const dbFile = path.join(__dirname, 'avadb.sqlite');
const db = new sqlite3.Database(dbFile, (err) => {
  if (err) {
    console.error('CRITICAL DATABASE ERROR:', err.message);
  } else {
    console.log('Connected to bulletproof local SQLite database (avadb.sqlite).');
  }
});

// Initialize Tables & Default State
db.serialize(() => {
  db.run(`CREATE TABLE IF NOT EXISTS leads (
    phone TEXT PRIMARY KEY,
    timestamp TEXT,
    name TEXT,
    vehicle TEXT,
    condition TEXT,
    budget TEXT,
    tier TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS chat_logs (
    phone TEXT,
    timestamp TEXT,
    sender TEXT,
    message TEXT
  )`);

  db.run(`CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  )`);

  // Insert default decision tree flow if not present
  const defaultFlow = JSON.stringify({
    greeting: "Hello there! Welcome to Potgieter Auto. My name is Ava. How can I help you find your perfect vehicle today? 🚙✨",
    branchNewUsed: "That's a fantastic choice! Are you looking for a brand new model, or perhaps a low-mileage demo/pre-owned option?",
    branchBudget: "Brilliant. To help tailor the best finance package through our major banking partners, what is your estimated monthly budget?",
    closing: "Thank you for sharing those details! A consultant will call you soon to finalise your paperwork."
  });

  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('botFlow', ?)`, [defaultFlow]);
  
  const defaultPrompt = `You are Ava, an elite senior car sales executive at Potgieter Auto in South Africa. Follow this strict decision tree flow: 1. Greeting 2. Find vehicle preference 3. Find New/Used condition 4. Find Budget 5. End with exact phrase 'A consultant will call you soon'.`;
  db.run(`INSERT OR IGNORE INTO settings (key, value) VALUES ('systemPrompt', ?)`, [defaultPrompt]);
});

// Helper: Get setting value
function getSetting(key) {
  return new Promise((resolve) => {
    db.get(`SELECT value FROM settings WHERE key = ?`, [key], (err, row) => {
      resolve(row ? row.value : null);
    });
  });
}

// Helper: Save setting value
function saveSetting(key, value) {
  return new Promise((resolve) => {
    db.run(`INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)`, [key, value], (err) => {
      resolve(!err);
    });
  });
}

// Helper: Get active chat histories from SQLite
function getConversationsFromDB() {
  return new Promise((resolve) => {
    db.all(`SELECT phone, timestamp, sender, message FROM chat_logs ORDER BY timestamp ASC`, [], (err, rows) => {
      if (err || !rows) {
        resolve({});
        return;
      }
      const conversations = {};
      rows.forEach(r => {
        if (!conversations[r.phone]) {
          conversations[r.phone] = { phone: r.phone, messages: [], lastUpdated: r.timestamp };
        }
        const role = r.sender === 'Ava' ? 'assistant' : 'user';
        conversations[r.phone].messages.push({ role, content: r.message });
        conversations[r.phone].lastUpdated = r.timestamp;
      });
      resolve(conversations);
    });
  });
}

function cleanHistoryForGemini(history) {
  let clean = [], expected = 'user';
  for (const msg of history) {
    if (!msg || !msg.content || typeof msg.content !== 'string' || msg.content.trim() === '') continue;
    let role = msg.role === 'assistant' ? 'model' : 'user';
    if (role === expected) {
      clean.push({ role, parts: [{ text: msg.content }] });
      expected = expected === 'user' ? 'model' : 'user';
    } else if (role === 'user' && expected === 'model') {
      if (clean.length > 0) clean[clean.length - 1].parts[0].text += `\n${msg.content}`;
    }
  }
  return clean;
}

async function extractLeadDetails(history) {
  const p = `Analyze conversation. Extract JSON. Fields: name, vehicle, condition (New/Used/Demo/Unknown), budget, tier (Hot/Warm/Cold). Unknown if missing. Raw JSON only.`;
  const contents = cleanHistoryForGemini(history);
  if (!contents.length) return null;
  return new Promise(r => {
    const req = https.request({
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          r(JSON.parse(JSON.parse(b).candidates[0].content.parts[0].text.trim()));
        } catch (e) { r(null); }
      });
    });
    req.on('error', () => r(null));
    req.write(JSON.stringify({ contents, systemInstruction: { parts: [{ text: p }] }, generationConfig: { responseMimeType: "application/json" } }));
    req.end();
  });
}

function sendWhatsAppMessage(to, msg, tmpl = null) {
  if (!WHATSAPP_TOKEN) return;
  const d = JSON.stringify(tmpl ? { messaging_product: 'whatsapp', to, type: 'template', template: { name: tmpl, language: { code: 'en_US' } } } : { messaging_product: 'whatsapp', to, type: 'text', text: { body: msg } });
  const req = https.request({ hostname: 'graph.facebook.com', path: `/v17.0/${PHONE_NUMBER_ID}/messages`, method: 'POST', headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } });
  req.on('error', () => { });
  req.write(d);
  req.end();
}

async function getAIResponse(history) {
  const rawFlow = await getSetting('botFlow');
  const systemPrompt = await getSetting('systemPrompt');
  let flowObj = {};
  try { flowObj = JSON.parse(rawFlow); } catch (e) { }

  const treeContext = `Decision Tree Script Structure:\n- Greeting Branch: "${flowObj.greeting || ''}"\n- Condition Branch: "${flowObj.branchNewUsed || ''}"\n- Budget Branch: "${flowObj.branchBudget || ''}"\n- Closing Branch: "${flowObj.closing || ''}"\n\nSystem Directive: ${systemPrompt}`;
  
  const data = JSON.stringify({ contents: cleanHistoryForGemini(history), systemInstruction: { parts: [{ text: treeContext }] }, generationConfig: { maxOutputTokens: 512 } });
  return new Promise(r => {
    const req = https.request({ hostname: 'generativelanguage.googleapis.com', path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`, method: 'POST', headers: { 'Content-Type': 'application/json' } }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try {
          const txt = JSON.parse(b).candidates[0].content.parts[0].text;
          r(txt ? txt.trim() : (flowObj.greeting || "Hello!"));
        } catch (e) { r(flowObj.greeting || "Hello!"); }
      });
    });
    req.on('error', () => r("Hello!"));
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
  const pUrl = url.parse(req.url, true);

  // 1. GET LEADS
  if (pUrl.pathname === '/api/leads' && req.method === 'GET') {
    db.all(`SELECT timestamp, name, phone, vehicle, condition, budget, tier FROM leads ORDER BY timestamp DESC`, [], (err, rows) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(rows || []));
    });
    return;
  }

  // 2. GET CONTACTS & CHATS
  if (pUrl.pathname === '/api/contacts' && req.method === 'GET') {
    const conversations = await getConversationsFromDB();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations }));
    return;
  }

  // 3. GET/POST FLOW TREE
  if (pUrl.pathname === '/api/flow' && req.method === 'GET') {
    const raw = await getSetting('botFlow');
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(raw || '{}');
    return;
  }
  if (pUrl.pathname === '/api/flow' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', async () => {
      await saveSetting('botFlow', b);
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true }));
    });
    return;
  }

  // 4. UPDATE LEAD TIER
  if (pUrl.pathname === '/api/update-lead' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const p = JSON.parse(b);
        db.run(`UPDATE leads SET tier = ? WHERE phone = ?`, [p.tier, p.phone], (err) => {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: !err }));
        });
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // 5. SEND LIVE MESSAGE
  if (pUrl.pathname === '/api/send-message' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        const p = JSON.parse(b);
        if (!p.phone) { res.writeHead(400); return res.end(JSON.stringify({ success: false })); }
        sendWhatsAppMessage(p.phone, p.message || '', p.useTemplate ? (p.templateName || 'hello_world') : null);
        const ts = new Date().toISOString();
        db.run(`INSERT INTO chat_logs (phone, timestamp, sender, message) VALUES (?, ?, 'Ava', ?)`, [p.phone, ts, p.message], () => {
          res.writeHead(200);
          res.end(JSON.stringify({ success: true }));
        });
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // 6. META TEMPLATE CREATOR
  if (pUrl.pathname === '/api/create-template' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', () => {
      try {
        if (!WABA_ID) { res.writeHead(400); return res.end(JSON.stringify({ success: false, error: "WABA_ID missing" })); }
        const p = JSON.parse(b);
        const payload = JSON.stringify({ name: p.name, language: "en_US", category: "MARKETING", components: [{ type: "BODY", text: p.body }] });
        const reqMeta = https.request({ hostname: 'graph.facebook.com', path: `/v17.0/${WABA_ID}/message_templates`, method: 'POST', headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' } }, metaRes => {
          let mb = '';
          metaRes.on('data', mc => mb += mc);
          metaRes.on('end', () => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.end(mb); });
        });
        reqMeta.on('error', () => res.end(JSON.stringify({ success: false })));
        reqMeta.write(payload);
        reqMeta.end();
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // 7. SANDBOX API
  if (pUrl.pathname === '/api/sandbox' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', async () => {
      try {
        const p = JSON.parse(b);
        const rep = await getAIResponse([{ role: 'user', content: p.message }]);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ reply: rep }));
      } catch (e) { res.writeHead(400); res.end(); }
    });
    return;
  }

  // 8. META WHATSAPP WEBHOOK (Inbound)
  if (pUrl.pathname === '/webhook' && req.method === 'GET') {
    const m = pUrl.query['hub.mode'], t = pUrl.query['hub.verify_token'], c = pUrl.query['hub.challenge'];
    if (m === 'subscribe' && t === VERIFY_TOKEN) { res.writeHead(200); res.end(c); } else { res.writeHead(403); res.end(); }
    return;
  }

  if (pUrl.pathname === '/webhook' && req.method === 'POST') {
    let b = '';
    req.on('data', c => b += c);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('OK');
      try {
        const payload = JSON.parse(b);
        const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message && message.type === 'text') {
          const f = message.from;
          const t = message.text.body;
          const n = payload.entry[0].changes[0].value.contacts[0].profile.name || 'there';
          const ts = new Date().toISOString();

          // Log User Message
          db.run(`INSERT INTO chat_logs (phone, timestamp, sender, message) VALUES (?, ?, 'Client', ?)`, [f, ts, t]);

          // Fetch recent conversation history for AI context
          db.all(`SELECT sender, message FROM chat_logs WHERE phone = ? ORDER BY timestamp ASC`, [f], async (err, rows) => {
            const history = (rows || []).map(r => ({ role: r.sender === 'Ava' ? 'assistant' : 'user', content: r.message }));
            const rep = await getAIResponse(history);

            // Log AI Response
            db.run(`INSERT INTO chat_logs (phone, timestamp, sender, message) VALUES (?, ?, 'Ava', ?)`, [f, ts, rep]);
            sendWhatsAppMessage(f, rep);

            // Background Lead Extraction & Upsert
            if (history.filter(x => x.role === 'user').length >= 2) {
              const ex = await extractLeadDetails(history);
              if (ex) {
                db.run(`INSERT INTO leads (phone, timestamp, name, vehicle, condition, budget, tier) VALUES (?, ?, ?, ?, ?, ?, ?) 
                        ON CONFLICT(phone) DO UPDATE SET name=excluded.name, vehicle=excluded.vehicle, condition=excluded.condition, budget=excluded.budget, tier=excluded.tier`,
                  [f, ts, ex.name || n, ex.vehicle || 'Unknown', ex.condition || 'Unknown', ex.budget || 'Unknown', ex.tier || 'Warm']);
              }
            }
          });
        }
      } catch (e) { }
    });
    return;
  }

  res.writeHead(200);
  res.end('Ava Bulletproof SQLite Engine Active');
});

server.listen(PORT, () => console.log('Ava SQLite Engine live on port ' + PORT));
// --- END OF FILE ---
