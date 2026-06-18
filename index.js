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

// Google Sheets Environment Variables (With Robust Private Key Fix)
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '').trim()
  : undefined;

console.log("API KEY EXISTS:", !!GEMINI_API_KEY);
console.log("SHEETS CONFIG EXISTS:", !!SPREADSHEET_ID && !!GOOGLE_SERVICE_ACCOUNT_EMAIL && !!GOOGLE_PRIVATE_KEY);

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const conversations = {};

// --- SAVE DIRECTLY TO GOOGLE SHEETS ---
async function saveToGoogleSheets(leadData) {
  try {
    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      console.log("SHEETS ERROR: Missing credentials in environment variables.");
      return;
    }

    const serviceAccountAuth = new JWT({
      email: GOOGLE_SERVICE_ACCOUNT_EMAIL,
      key: GOOGLE_PRIVATE_KEY,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });

    const doc = new GoogleSpreadsheet(SPREADSHEET_ID, serviceAccountAuth);
    await doc.loadInfo();
    
    const sheet = doc.sheetsByIndex[0]; 
    
    await sheet.addRow({
      'Date': new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' }),
      'Name': leadData.name,
      'Phone': leadData.phone,
      'Vehicle': leadData.vehicle,
      'Condition': leadData.condition,
      'Budget': leadData.budget,
      'Tier': leadData.tier
    });
    
    console.log("SHEETS SUCCESS: Lead successfully appended to Google Sheet!");
  } catch (error) {
    console.error("SHEETS ERROR: Failed to append row:", error);
  }
}

// --- ANALYZE CHAT AND EXTRACT DATA ---
async function extractLeadDetails(history) {
  console.log("EXTRACTING LEAD DETAILS VIA GEMINI...");
  
  const analysisPrompt = `Analyze the conversation history between a car sales agent and a customer. Extract the following information into raw JSON format.

If an explicit answer isn't present in the chat for a field, put "Unknown".
For "Condition", it must strictly be: "New", "Used", "Demo", or "Unknown".
For "Tier", categorize the lead as:
- "Hot" (If they provided a specific vehicle preference, explicit budget AND clear phone/contact number)
- "Warm" (If they are engaging and provided a budget/car preference but haven't fully committed to contact info yet)
- "Cold" (If they are barely responding or uninterested)

Provide ONLY raw JSON matching this template without markdown code fences:
{
  "name": "Customer Name",
  "phone": "Phone Number",
  "vehicle": "Make/Model Preference",
  "condition": "New/Used/Demo/Unknown",
  "budget": "Budget details",
  "tier": "Hot/Warm/Cold"
}`;

  const validHistory = history.filter(msg => msg && typeof msg.content === 'string' && msg.content.trim() !== '');

  const geminiContents = validHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  if (geminiContents.length === 0) {
    return { name: "Unknown", phone: "Unknown", vehicle: "Unknown", condition: "Unknown", budget: "Unknown", tier: "Cold" };
  }

  const data = JSON.stringify({
    contents: geminiContents,
    generationConfig: { responseMimeType: "application/json" }
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
          const jsonText = parsed.candidates[0].content.parts[0].text;
          resolve(JSON.parse(jsonText.trim()));
        } catch (e) {
          console.log("EXTRACTION PARSE ERROR:", e);
          resolve({ name: "Unknown", phone: "Unknown", vehicle: "Unknown", condition: "Unknown", budget: "Unknown", tier: "Cold" });
        }
      });
    });
    req.on('error', () => resolve({ name: "Unknown", phone: "Unknown", vehicle: "Unknown", condition: "Unknown", budget: "Unknown", tier: "Cold" }));
    req.write(data);
    req.end();
  });
}

// --- SEND WHATSAPP MESSAGE ---
function sendWhatsAppMessage(to, message) {
  console.log("SENDING TO:", to);
  
  const data = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v17.0/${PHONE_NUMBER_ID}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let body = '';
    res.on('data', chunk => body += chunk);
    res.on('end', () => console.log("WHATSAPP RESPONSE:", body));
  });

  req.on('error', (err) => console.log("WHATSAPP ERROR:", err));
  req.write(data);
  req.end();
}

// --- SEND TO MAKE ---
function sendToMake(data) {
  if (!MAKE_WEBHOOK_URL) return;
  const makeUrl = new URL(MAKE_WEBHOOK_URL);
  const body = JSON.stringify(data);
  const options = {
    hostname: makeUrl.hostname,
    path: makeUrl.pathname,
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  };
  const req = https.request(options);
  req.write(body);
  req.end();
}

// --- GET AI RESPONSE (SANITIZED & SAFE) ---
async function getAIResponse(userMessage, history, userName) {
  console.log("ENTERED getAIResponse");
  
  const systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and tell them a consultant will call them soon.
Keep messages short and conversational. Use emojis occasionally. Never be pushy. Speak naturally like a real South African sales person.`;

  const validHistory = history.filter(msg => msg && typeof msg.content === 'string' && msg.content.trim() !== '');

  const geminiContents = validHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  if (geminiContents.length === 0) {
    geminiContents.push({
      role: 'user',
      parts: [{ text: userMessage || 'Hi' }]
    });
  }

  const data = JSON.stringify({
    contents: geminiContents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
    generationConfig: { maxOutputTokens: 1024 }
  });

  console.log("ABOUT TO CALL GEMINI 2.5 FLASH WITH SANITIZED HISTORY");

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
          
          if (res.statusCode !== 200) {
            console.log(`GEMINI API ERROR CODE ${res.statusCode}:`, body);
            resolve("Sorry, I'm having a brief look at our stock system. Give me one moment!");
            return;
          }

          const aiText = parsed.candidates[0].content.parts[0].text;
          resolve(aiText.trim());
        } catch (e) {
          console.log("JSON PARSE ERROR IN AI RESPONSE:", e);
          resolve("Sorry, I'm checking that info for you right now.");
        }
      });
    });
    req.on('error', (err) => {
      console.log("HTTPS REQUEST ERROR IN AI RESPONSE:", err);
      resolve("Sorry, let me look into that for you.");
    });
    req.write(data);
    req.end();
  });
}

// --- SERVER INSTANCE ---
const server = http.createServer(async (req, res) => {
  const parsedUrl = url.parse(req.url, true);

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
      try {
        const payload = JSON.parse(body);
        const entry = payload.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const message = value?.messages?.[0];

        if (message && message.type === 'text') {
          const from = message.from;
          const text = message.text.body;
          const name = value.contacts?.[0]?.profile?.name || 'there';

          if (!conversations[from]) conversations[from] = [];
          
          // Protect payload: strict role alternation logic
          const lastTurn = conversations[from][conversations[from].length - 1];
          if (!lastTurn || lastTurn.role === 'assistant') {
            conversations[from].push({ role: 'user', content: text });
          } else if (lastTurn && lastTurn.role === 'user') {
            lastTurn.content += ` ${text}`;
          }

          const aiReply = await getAIResponse(text, conversations[from], name);
          
          // Never push system fallback errors to history
          if (!aiReply.includes("stock system") && !aiReply.includes("checking that info")) {
            conversations[from].push({ role: 'assistant', content: aiReply });
          }

          sendWhatsAppMessage(from, aiReply);

          const extractedData = await extractLeadDetails(conversations[from]);
          if (extractedData.name === "Unknown") extractedData.name = name;
          extractedData.phone = from;
          
          await saveToGoogleSheets(extractedData);

          sendToMake({
            name: name,
            phone: from,
            last_message: text,
            ai_response: aiReply,
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {
        console.log("WEBHOOK PROCESSING ERROR:", e);
      }
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  res.writeHead(200);
  res.end('Potgieter Auto Sales Bot - Ava is ready!');
});

server.listen(PORT, () => console.log('Ava is live on port ' + PORT));
