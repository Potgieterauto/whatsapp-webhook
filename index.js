const http = require('http');
const https = require('https');
const url = require('url');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Potgieterauto';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '').trim()
  : undefined;

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

// UPGRADED MEMORY STORE FOR LIVE CHAT
const conversations = {};

let currentSystemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and explicitly use the phrase "a consultant will call you soon" so the backend knows they are ready.
Keep messages short and conversational. Use emojis occasionally. Speak naturally like a real South African salesperson.`;

function cleanHistoryForGemini(history) {
  const clean = [];
  let expectedRole = 'user';
  for (const msg of history) {
    if (!msg || !msg.content || typeof msg.content !== 'string' || msg.content.trim() === '') continue;
    const currentRole = msg.role === 'assistant' ? 'model' : 'user';
    if (currentRole === expectedRole) {
      clean.push({ role: currentRole, parts: [{ text: msg.content }] });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    } else if (currentRole === 'user' && expectedRole === 'model') {
      if (clean.length > 0) clean[clean.length - 1].parts[0].text += `\n${msg.content}`;
    }
  }
  return clean;
}

async function saveToGoogleSheets(phone, name, rawHistory, extractedData = null) {
  try {
    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) return;
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    const clientSheet = doc.sheetsByTitle['Clients'] || doc.sheetsByIndex[0];
    const logSheet = doc.sheetsByTitle['Chat Logs'];
    const clientRows = await clientSheet.getRows();
    const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    
    const latestMessageObj = rawHistory[rawHistory.length - 1];
    const latestText = latestMessageObj?.content || "";
    const existingClientRow = clientRows.find(row => String(row.get('Phone')) === String(phone));

    if (existingClientRow) {
      const updatePayload = { 'Date': timestamp };
      if (extractedData) {
        if (extractedData.name && extractedData.name !== "Unknown") updatePayload['Name'] = extractedData.name;
        if (extractedData.vehicle && extractedData.vehicle !== "Unknown") updatePayload['Vehicle'] = extractedData.vehicle;
        if (extractedData.condition && extractedData.condition !== "Unknown") updatePayload['Condition'] = extractedData.condition;
        if (extractedData.budget && extractedData.budget !== "Unknown") updatePayload['Budget'] = extractedData.budget;
        if (extractedData.tier) updatePayload['Tier'] = extractedData.tier;
      } else if (name && (!existingClientRow.get('Name') || existingClientRow.get('Name') === 'Unknown')) {
        updatePayload['Name'] = name;
      }
      existingClientRow.assign(updatePayload);
      await existingClientRow.save();
    } else {
      await clientSheet.addRow({
        'Date': timestamp,
        'Name': extractedData?.name || name || 'Unknown',
        'Phone': phone,
        'Vehicle': extractedData?.vehicle || 'Unknown',
        'Condition': extractedData?.condition || 'Unknown',
        'Budget': extractedData?.budget || 'Unknown',
        'Tier': extractedData?.tier || 'Warm'
      });
    }

    if (logSheet && latestMessageObj) {
      const logRows = await logSheet.getRows();
      const existingLogRow = logRows.find(row => String(row.get('Phone')) === String(phone));
      const senderLabel = latestMessageObj.role === 'assistant' ? 'Ava' : 'Client';
      const formattedLogText = `[${senderLabel}]: ${latestText}`;

      if (existingLogRow) {
        const currentMessages = existingLogRow.get('Message') || "";
        existingLogRow.assign({
          'Timestamp': timestamp,
          'Sender': senderLabel,
          'Message': currentMessages ? `${currentMessages} | ${formattedLogText}` : formattedLogText
        });
        await existingLogRow.save();
      } else {
        await logSheet.addRow({
          'Timestamp': timestamp,
          'Phone': phone,
          'Sender': senderLabel,
          'Message': formattedLogText
        });
      }
    }
  } catch (error) {
    console.error("SHEETS ERROR:", error.message);
  }
}

async function fetchLeadsFromGoogleSheets() {
  try {
    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) return [];
    
    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    
    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    const clientSheet = doc.sheetsByTitle['Clients'] || doc.sheetsByIndex[0];
    const rows = await clientSheet.getRows();
    
    return rows.map(row => ({
      timestamp: row.get('Date') || '',
      name: row.get('Name') || 'Unknown',
      phone: row.get('Phone') || '',
      vehicle: row.get('Vehicle') || 'Unknown',
      condition: row.get('Condition') || 'Unknown',
      budget: row.get('Budget') || 'Unknown',
      tier: row.get('Tier') || 'Warm'
    }));
  } catch (error) {
    return [];
  }
}

async function extractLeadDetails(history) {
  const analysisPrompt = `Analyze the conversation history between a car sales agent and a customer. Extract the following information into raw JSON format.
If an explicit answer isn't present in the chat for a field, put "Unknown".
For "Condition", it must strictly be: "New", "Used", "Demo", or "Unknown".
For "Tier", categorize the lead as exactly "Hot", "Warm", or "Cold". Do not choose anything else.

Provide ONLY raw JSON matching this template without markdown code fences:
{
  "name": "Customer Name",
  "vehicle": "Make/Model Preference",
  "condition": "New/Used/Demo/Unknown",
  "budget": "Budget details",
  "tier": "Hot/Warm/Cold"
}`;

  const geminiContents = cleanHistoryForGemini(history);
  if (geminiContents.length === 0) return null;

  return new Promise((resolve) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const jsonText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          if (!jsonText) {
            resolve(null);
            return;
          }
          resolve(JSON.parse(jsonText.trim()));
        } catch (e) {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(JSON.stringify({
      contents: geminiContents,
      systemInstruction: { parts: [{ text: analysisPrompt }] },
      generationConfig: { responseMimeType: "application/json" }
    }));
    req.end();
  });
}

function sendWhatsAppMessage(to, message, templateName = null) {
  if (!WHATSAPP_TOKEN || !PHONE_NUMBER_ID) return;

  const payload = templateName ? {
    messaging_product: 'whatsapp',
    to: to,
    type: 'template',
    template: {
      name: templateName,
      language: { code: 'en_US' }
    }
  } : {
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message }
  };

  const data = JSON.stringify(payload);
  
  const options = {
    hostname: 'graph.facebook.com',
    path: `/v17.0/${PHONE_NUMBER_ID}/messages`,
    method: 'POST',
    headers: { 'Authorization': `Bearer ${WHATSAPP_TOKEN}`, 'Content-Type': 'application/json' }
  };
  
  const req = https.request(options);
  req.on('error', (err) => console.error("WHATSAPP SEND ERROR:", err.message));
  req.write(data);
  req.end();
}

function sendToMake(data) {
  if (!MAKE_WEBHOOK_URL) return;
  try {
    const makeUrl = new URL(MAKE_WEBHOOK_URL);
    const options = {
      hostname: makeUrl.hostname,
      path: makeUrl.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options);
    req.on('error', () => {});
    req.write(JSON.stringify(data));
    req.end();
  } catch (err) {}
}

async function getAIResponse(history) {
  const geminiContents = cleanHistoryForGemini(history);
  const data = JSON.stringify({
    contents: geminiContents,
    systemInstruction: { parts: [{ text: currentSystemPrompt }] },
    generationConfig: { maxOutputTokens: 512 }
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'generativelanguage.googleapis.com',
      path: `/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
      method: 'POST',
      headers: { 'Content-Type': 'application/json' }
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          const replyText = parsed.candidates?.[0]?.content?.parts?.[0]?.text;
          resolve(replyText ? replyText.trim() : "Sorry, let me check that info for you.");
        } catch (e) {
          resolve("Sorry, I'm checking that info for you right now.");
        }
      });
    });
    req.on('error', () => resolve("Sorry, let me look into that for you."));
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  const parsedUrl = url.parse(req.url, true);

  if (parsedUrl.pathname === '/api/leads' && req.method === 'GET') {
    const leads = await fetchLeadsFromGoogleSheets();
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(leads));
    return;
  }

  if (parsedUrl.pathname === '/api/contacts' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ conversations }));
    return;
  }

  if (parsedUrl.pathname === '/api/send-message' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', () => {
      try {
        const parsed = JSON.parse(body);
        if (parsed.phone) {
          const templateName = parsed.useTemplate ? (parsed.templateName || 'hello_world') : null;
          const msg = parsed.message || '';
          
          sendWhatsAppMessage(parsed.phone, msg, templateName);
          
          // UPGRADE: Inject manual outbound messages directly into the live chat history
          if (!conversations[parsed.phone]) {
            conversations[parsed.phone] = { name: "Manual Contact", phone: parsed.phone, messages: [], lastUpdated: new Date().toISOString() };
          }
          if (msg) {
             conversations[parsed.phone].messages.push({ role: 'assistant', content: msg });
             conversations[parsed.phone].lastUpdated = new Date().toISOString();
          }

          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true }));
        } else {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: "Missing phone number" }));
        }
      } catch (e) {
        res.writeHead(400, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, error: "Invalid JSON" }));
      }
    });
    return;
  }

  if (parsedUrl.pathname === '/webhook' && req.method === 'GET') {
    const mode = parsedUrl.query['hub.mode'];
    const token = parsedUrl.query['hub.verify_token'];
    const challenge = parsedUrl.query['hub.challenge'];
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      res.writeHead(200);
      res.end(challenge);
    } else {
      res.writeHead(403);
      res.end('Forbidden');
    }
    return;
  }

  if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {
    let body = '';
    req.on('data', chunk => body += chunk);
    req.on('end', async () => {
      res.writeHead(200);
      res.end('OK');
      try {
        const payload = JSON.parse(body);
        const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];
        if (message && message.type === 'text') {
          const from = message.from;
          const text = message.text.body;
          const name = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'there';

          // UPGRADE: Create rich conversation object
          if (!conversations[from]) {
            conversations[from] = { name: name, phone: from, messages: [], lastUpdated: new Date().toISOString() };
          }
          
          conversations[from].messages.push({ role: 'user', content: text });
          conversations[from].lastUpdated = new Date().toISOString();

          const aiReply = await getAIResponse(conversations[from].messages);
          conversations[from].messages.push({ role: 'assistant', content: aiReply });
          sendWhatsAppMessage(from, aiReply);

          (async () => {
            try {
              let extractedData = null;
              const userTurnsCount = conversations[from].messages.filter(m => m.role === 'user').length;
              if (userTurnsCount >= 2 && userTurnsCount % 2 === 0) {
                extractedData = await extractLeadDetails(conversations[from].messages);
              }
              await saveToGoogleSheets(from, name, conversations[from].messages, extractedData);
              sendToMake({ name, phone: from, last_message: text, ai_response: aiReply, timestamp: new Date().toISOString() });
            } catch (err) {}
          })();
        }
      } catch (e) {}
    });
    return;
  }

  res.writeHead(200, { 'Content-Type': 'text/plain' });
  res.end('Ava Engine Active & Connected.');
});

server.listen(PORT, () => console.log('Ava live on port ' + PORT));
// --- END OF FILE ---
STEP 2: Update Your Frontend (index.html)
Go to your frontend repository in GitHub. Delete everything in index.html, click "Copy code", paste it in, and verify // --- END OF FILE --- is at the very bottom.

This version actively maps your chat contacts to the sidebar and allows you to chat back and forth in real time.

HTML
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Potgieter Auto | Ava CRM</title>
    <style>
        :root {
            --bg-dark: #0f172a;
            --sidebar-bg: #1e293b;
            --card-bg: #1e293b;
            --border-color: #334155;
            --text-main: #f8fafc;
            --text-muted: #94a3b8;
            --accent-green: #10b981;
            --accent-blue: #3b82f6;
            --hover-bg: #334155;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background-color: var(--bg-dark); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }
        
        .sidebar { width: 250px; background-color: var(--sidebar-bg); border-right: 1px solid var(--border-color); display: flex; flex-direction: column; padding: 20px 0; }
        .brand { font-size: 20px; font-weight: bold; padding: 0 20px 20px; border-bottom: 1px solid var(--border-color); margin-bottom: 20px; color: var(--text-main); display: flex; align-items: center; gap: 10px; }
        .nav-btn { background: none; border: none; color: var(--text-muted); padding: 15px 20px; text-align: left; font-size: 15px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 10px; width: 100%; }
        .nav-btn:hover { background-color: var(--hover-bg); color: var(--text-main); }
        .nav-btn.active { background-color: rgba(59, 130, 246, 0.1); color: var(--accent-blue); border-right: 4px solid var(--accent-blue); }
        
        .main-content { flex: 1; padding: 30px; overflow-y: auto; }
        .page { display: none; animation: fadeIn 0.3s ease; }
        .page.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(10px); } to { opacity: 1; transform: translateY(0); } }
        
        h2 { margin-bottom: 20px; font-size: 24px; font-weight: 600; border-bottom: 1px solid var(--border-color); padding-bottom: 10px; }
        
        .card { background: var(--card-bg); border: 1px solid var(--border-color); border-radius: 12px; padding: 20px; margin-bottom: 20px; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2); }
        .form-input, .form-select, .form-textarea { width: 100%; background: #020617; border: 1px solid var(--border-color); color: var(--text-main); padding: 12px; border-radius: 6px; margin-bottom: 15px; outline: none; font-size: 14px; }
        .form-input:focus, .form-textarea:focus { border-color: var(--accent-blue); }
        .form-textarea { min-height: 150px; resize: vertical; }
        .btn { background: var(--accent-blue); color: white; padding: 10px 20px; border: none; border-radius: 6px; cursor: pointer; font-weight: 600; }
        .btn-green { background: var(--accent-green); color: #020617; }
        
        .filter-row { display: flex; gap: 10px; margin-bottom: 20px; flex-wrap: wrap; }
        .filter-pill { background: var(--sidebar-bg); border: 1px solid var(--border-color); color: var(--text-muted); padding: 6px 15px; border-radius: 20px; cursor: pointer; font-size: 13px; }
        .filter-pill:hover, .filter-pill.active { background: var(--accent-blue); color: white; border-color: var(--accent-blue); }
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
        th { color: var(--text-muted); padding: 15px 10px; border-bottom: 1px solid var(--border-color); }
        td { padding: 15px 10px; border-bottom: 1px solid var(--border-color); }
        .badge-deal { background: rgba(16, 185, 129, 0.2); color: var(--accent-green); padding: 4px 8px; border-radius: 4px; font-size: 12px; }
        .badge-nodeal { background: rgba(239, 68, 68, 0.2); color: #ef4444; padding: 4px 8px; border-radius: 4px; font-size: 12px; }

        /* UPGRADED CHAT UI */
        .chat-container { display: flex; height: calc(100vh - 120px); border: 1px solid var(--border-color); border-radius: 12px; overflow: hidden; }
        .chat-sidebar { width: 300px; border-right: 1px solid var(--border-color); background: var(--card-bg); overflow-y: auto; }
        .chat-contact { padding: 15px; border-bottom: 1px solid var(--border-color); cursor: pointer; transition: 0.2s; }
        .chat-contact:hover { background: var(--hover-bg); }
        .chat-main { flex: 1; display: flex; flex-direction: column; background: #020617; }
        .chat-history { flex: 1; padding: 20px; overflow-y: auto; display: flex; flex-direction: column; }
        .chat-input-area { padding: 15px; background: var(--card-bg); border-top: 1px solid var(--border-color); display: flex; gap: 10px; }
        
        .chat-bubble { padding: 10px 15px; border-radius: 8px; max-width: 70%; margin-bottom: 15px; font-size: 14px; line-height: 1.4; border: 1px solid var(--border-color); }
        .bubble-client { background: var(--card-bg); color: var(--text-main); align-self: flex-start; }
        .bubble-bot { background: var(--accent-blue); color: white; align-self: flex-end; border-color: var(--accent-blue); }
    </style>
</head>
<body>

    <div class="sidebar">
        <div class="brand">🚗 Potgieter Auto</div>
        <button class="nav-btn active" onclick="switchPage('page-leads', this)">📊 CRM Leads</button>
        <button class="nav-btn" onclick="switchPage('page-chat', this)">💬 Live WhatsApp</button>
        <button class="nav-btn" onclick="switchPage('page-bot', this)">🤖 Ava Bot Flow</button>
        <button class="nav-btn" onclick="switchPage('page-templates', this)">📄 Media Templates</button>
        <button class="nav-btn" onclick="switchPage('page-sandbox', this)">🧪 Sandbox Testing</button>
    </div>

    <div class="main-content">
        
        <!-- PAGE 1: LEADS CRM -->
        <div id="page-leads" class="page active">
            <h2>Lead Pipeline & CRM</h2>
            <div class="filter-row">
                <div class="filter-pill active">All Leads</div>
                <div class="filter-pill">Hot Deals</div>
                <div class="filter-pill">Warm</div>
                <div class="filter-pill">No Deal</div>
            </div>
            <div class="card">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Client Name</th>
                            <th>Phone</th>
                            <th>Vehicle Interest</th>
                            <th>Ava Verdict</th>
                        </tr>
                    </thead>
                    <tbody id="crm-table-body">
                        <tr><td colspan="5" style="text-align:center;">Loading leads from server...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- PAGE 2: LIVE WHATSAPP CHAT -->
        <div id="page-chat" class="page">
            <h2>Live Client Conversations</h2>
            <div class="chat-container">
                <div class="chat-sidebar" id="chat-list">
                    <div style="padding: 15px; color: var(--text-muted); text-align: center;">Waiting for active chats...</div>
                </div>
                <div class="chat-main">
                    <div class="chat-history" id="chat-history-container">
                        <div style="text-align: center; color: var(--text-muted); margin-top: 50px;">Select a contact on the left to view history</div>
                    </div>
                    <div class="chat-input-area">
                        <input type="text" id="live-chat-input" class="form-input" style="margin-bottom: 0;" placeholder="Take over chat and type message to client...">
                        <button class="btn btn-green" onclick="sendLiveMessage()">Send</button>
                    </div>
                </div>
            </div>
        </div>

        <!-- PAGE 3: BOT FLOW & PROMPT -->
        <div id="page-bot" class="page">
            <h2>Ava AI Behavior Engine</h2>
            <div class="card">
                <p style="color: var(--text-muted); margin-bottom: 15px;">Edit Ava's core instructions here. This updates how she responds to clients in real-time.</p>
                <textarea id="system-prompt-input" class="form-textarea">Loading current prompt...</textarea>
                <button class="btn" onclick="updatePrompt()">Save AI Logic</button>
            </div>
        </div>

        <!-- PAGE 4: WHATSAPP TEMPLATES -->
        <div id="page-templates" class="page">
            <h2>WhatsApp Media Templates</h2>
            <div class="card">
                <p style="color: var(--text-muted); margin-bottom: 15px;">Draft templates to send to Meta for approval (Requires backend integration with Meta Business API).</p>
                <input type="text" class="form-input" placeholder="Template Name (e.g., promo_december)">
                <select class="form-select">
                    <option>Text Only</option>
                    <option>Image + Text</option>
                    <option>Video + Text</option>
                    <option>PDF Document + Text</option>
                </select>
                <textarea class="form-textarea" placeholder="Template Body text..."></textarea>
                <button class="btn">Submit for Meta Approval</button>
            </div>
        </div>

        <!-- PAGE 5: SANDBOX -->
        <div id="page-sandbox" class="page">
            <h2>Ava Test Sandbox</h2>
            <div class="card" style="height: 60vh; display: flex; flex-direction: column;">
                <div style="flex: 1; background: #020617; border-radius: 8px; padding: 15px; margin-bottom: 15px; border: 1px solid var(--border-color);">
                    <p style="color: var(--text-muted); text-align: center;">Test Ava here without affecting real clients.</p>
                </div>
                <div style="display: flex; gap: 10px;">
                    <input type="text" class="form-input" style="margin-bottom: 0;" placeholder="Say something to Ava...">
                    <button class="btn btn-green">Send to Bot</button>
                </div>
            </div>
        </div>

    </div>

    <script>
        const backendUrl = window.VITE_BACKEND_URL || "https://whatsapp-webhook-fp3x.onrender.com";
        let chatData = {};
        let activeChatPhone = null;

        // --- NAVIGATION LOGIC ---
        function switchPage(pageId, btnElement) {
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            
            document.getElementById(pageId).classList.add('active');
            btnElement.classList.add('active');

            if (pageId === 'page-leads') loadLeads();
            if (pageId === 'page-chat') loadLiveChats();
        }

        // --- CRM LOGIC ---
        function loadLeads() {
            fetch(`${backendUrl}/api/leads`)
                .then(res => res.json())
                .then(data => {
                    const tbody = document.getElementById('crm-table-body');
                    if (data && data.length > 0) {
                        tbody.innerHTML = data.map(lead => {
                            let badgeClass = lead.tier === 'Cold' ? 'badge-nodeal' : 'badge-deal';
                            return `
                            <tr>
                                <td style="color: var(--text-muted);">${lead.timestamp}</td>
                                <td><strong>${lead.name}</strong></td>
                                <td style="font-family: monospace; color: var(--accent-blue);">${lead.phone}</td>
                                <td>${lead.vehicle}</td>
                                <td><span class="${badgeClass}">${lead.tier || 'Warm'}</span></td>
                            </tr>
                        `}).join('');
                    }
                }).catch(() => {});
        }

        // --- LIVE CHAT ENGINE ---
        function loadLiveChats() {
            fetch(`${backendUrl}/api/contacts`)
                .then(res => res.json())
                .then(data => {
                    chatData = data.conversations || {};
                    renderChatSidebar();
                    if (activeChatPhone && chatData[activeChatPhone]) {
                        renderChatHistory(activeChatPhone);
                    }
                }).catch(() => {});
        }

        function renderChatSidebar() {
            const sidebar = document.getElementById('chat-list');
            const phones = Object.keys(chatData).sort((a, b) => new Date(chatData[b].lastUpdated) - new Date(chatData[a].lastUpdated));
            
            if (phones.length === 0) {
                sidebar.innerHTML = '<div style="padding: 15px; color: var(--text-muted); text-align: center;">No active chats</div>';
                return;
            }

            sidebar.innerHTML = phones.map(phone => {
                const chat = chatData[phone];
                const msgs = chat.messages || [];
                const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1].content.substring(0, 30) + '...' : 'New contact';
                const isActive = activeChatPhone === phone ? 'background: var(--hover-bg); border-left: 3px solid var(--accent-blue);' : '';
                
                return `
                <div class="chat-contact" style="${isActive}" onclick="selectChat('${phone}')">
                    <strong>${chat.name} (${phone})</strong><br>
                    <small style="color: var(--text-muted)">${lastMsg}</small>
                </div>
                `;
            }).join('');
        }

        function selectChat(phone) {
            activeChatPhone = phone;
            renderChatSidebar();
            renderChatHistory(phone);
        }

        function renderChatHistory(phone) {
            const historyContainer = document.getElementById('chat-history-container');
            const chat = chatData[phone];
            
            if (!chat || !chat.messages || chat.messages.length === 0) {
                historyContainer.innerHTML = '<div style="text-align: center; color: var(--text-muted); margin-top: 50px;">No message history</div>';
                return;
            }

            historyContainer.innerHTML = chat.messages.map(msg => {
                const isUser = msg.role === 'user';
                const bubbleClass = isUser ? 'bubble-client' : 'bubble-bot';
                const senderName = isUser ? chat.name : 'Potgieter Auto';
                return `
                <div style="display: flex; flex-direction: column; width: 100%;">
                    <small style="color: var(--text-muted); margin-bottom: 5px; ${isUser ? 'align-self: flex-start;' : 'align-self: flex-end;'}">${senderName}</small>
                    <div class="chat-bubble ${bubbleClass}">
                        ${msg.content.replace(/\n/g, '<br>')}
                    </div>
                </div>
                `;
            }).join('');
            
            // Auto scroll to bottom
            historyContainer.scrollTop = historyContainer.scrollHeight;
        }

        function sendLiveMessage() {
            if (!activeChatPhone) {
                alert('Please select a contact from the sidebar first.');
                return;
            }
            
            const input = document.getElementById('live-chat-input');
            const message = input.value.trim();
            if (!message) return;
            
            input.value = '';
            
            // Send to Meta backend
            fetch(`${backendUrl}/api/send-message`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: activeChatPhone, message: message })
            }).then(() => loadLiveChats()); // Force instant refresh
        }

        // --- BACKGROUND POLLING ---
        // Auto-refresh chat logs every 5 seconds to simulate a live Web Socket
        setInterval(() => {
            if (document.getElementById('page-chat').classList.contains('active')) {
                loadLiveChats();
            }
        }, 5000);

        // Run initial loads
        loadLeads();
    </script>
</body>
</html>
// --- END OF FILE ---
