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

// Google Sheets Environment Variables
const SPREADSHEET_ID = process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY = process.env.GOOGLE_PRIVATE_KEY
  ? process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n').replace(/"/g, '').trim()
  : undefined;

const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;
const conversations = {};

// Helper utility to clean chat history for Gemini API
function cleanHistoryForGemini(history) {
  const clean = [];
  let expectedRole = 'user';

  for (const msg of history) {
    if (!msg || !msg.content || msg.content.trim() === '') continue;
    
    const currentRole = msg.role === 'assistant' ? 'model' : 'user';

    if (currentRole === expectedRole) {
      clean.push({
        role: currentRole,
        parts: [{ text: msg.content }]
      });
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    } else if (currentRole === 'user' && expectedRole === 'model') {
      if (clean.length > 0) {
        clean[clean.length - 1].parts[0].text += `\n${msg.content}`;
      }
    }
  }
  return clean;
}

// --- SAVE OR UPDATE ROW PER CLIENT (SINGLE-LINE LOGGING ENGINE) ---
async function saveToGoogleSheets(phone, name, rawHistory, extractedData = null) {
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
    
    const clientSheet = doc.sheetsByTitle['Clients'] || doc.sheetsByIndex[0];
    const logSheet = doc.sheetsByTitle['Chat Logs'];

    const clientRows = await clientSheet.getRows();
    const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    
    const latestMessageObj = rawHistory[rawHistory.length - 1];
    const latestText = latestMessageObj?.content || "";

    const existingClientRow = clientRows.find(row => String(row.get('Phone')) === String(phone));

    // 1. CRM SUMMARY ENTRY LOGIC (TAB 1: 'Clients')
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

    // 2. CONSOLIDATED LIVE CHAT LOGIC (TAB 2: 'Chat Logs')
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
    console.error("SHEETS ASYNC ERROR:", error.message || error);
  }
}

// --- OPTIMIZED SMART EXTRACTION CALL ---
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
          const jsonText = parsed.candidates[0].content.parts[0].text;
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

// --- SEND WHATSAPP MESSAGE ---
function sendWhatsAppMessage(to, message) {
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
    res.on('end', () => {});
  });
  req.on('error', (err) => console.error("WHATSAPP SEND ERROR:", err.message));
  req.write(data);
  req.end();
}

// --- SEND TO MAKE ---
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
    req.on('error', (err) => console.error("MAKE WEBHOOK ERROR:", err.message));
    req.write(JSON.stringify(data));
    req.end();
  } catch (err) {
    console.error("MAKE URL PARSE ERROR:", err.message);
  }
}

// --- GET AI RESPONSE (WITH AUTOMATIC RETRY ON 503 OVERLOAD) ---
async function getAIResponse(userMessage, history, userName, retries = 2) {
  const systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and explicitly use the phrase "a consultant will call you soon" so the backend knows they are ready.
Keep messages short and conversational. Use emojis occasionally. Speak naturally like a real South African salesperson.`;

  const geminiContents = cleanHistoryForGemini(history);

  const data = JSON.stringify({
    contents: geminiContents,
    systemInstruction: { parts: [{ text: systemPrompt }] },
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
      res.on('end', async () => {
        try {
          if (res.statusCode === 503 && retries > 0) {
            console.log(`GEMINI 503 DETECTED: Retrying in 1.5 seconds... (${retries} retries left)`);
            await new Promise(r => setTimeout(r, 1500));
            const retryResponse = await getAIResponse(userMessage, history, userName, retries - 1);
            resolve(retryResponse);
            return;
          }

          if (res.statusCode !== 200) {
            console.log("GEMINI API ERROR STATUS:", res.statusCode);
            resolve("Sorry, I'm having a brief look at our stock system. Give me one moment!");
            return;
          }
          const parsed = JSON.parse(body);
          resolve(parsed.candidates[0].content.parts[0].text.trim());
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

// --- MAIN WEBHOOK ENGINE ---
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
      res.writeHead(200);
      res.end('OK');

      try {
        const payload = JSON.parse(body);
        const message = payload.entry?.[0]?.changes?.[0]?.value?.messages?.[0];

        if (message && message.type === 'text') {
          const from = message.from;
          const text = message.text.body;
          const name = payload.entry?.[0]?.changes?.[0]?.value?.contacts?.[0]?.profile?.name || 'there';

          if (!conversations[from]) conversations[from] = [];
          
          const lastTurn = conversations[from][conversations[from].length - 1];
          if (!lastTurn || lastTurn.role === 'assistant') {
            conversations[from].push({ role: 'user', content: text });
          } else if (lastTurn && lastTurn.role === 'user') {
            lastTurn.content += ` ${text}`;
          }

          const aiReply = await getAIResponse(text, conversations[from], name);
          
          if (!aiReply.includes("stock system") && !aiReply.includes("checking that info")) {
            conversations[from].push({ role: 'assistant', content: aiReply });
          }

          sendWhatsAppMessage(from, aiReply);

          (async () => {
            let extractedData = null;
            const userTurnsCount = conversations[from].filter(m => m.role === 'user').length;
            
            if (userTurnsCount >= 2 && userTurnsCount % 2 === 0) {
              extractedData = await extractLeadDetails(conversations[from]);
            }

            await saveToGoogleSheets(from, name, conversations[from], extractedData);

            sendToMake({
              name: name,
              phone: from,
              last_message: text,
              ai_response: aiReply,
              timestamp: new Date().toISOString()
            });
          })();
        }
      } catch (e) {
        console.log("WEBHOOK PROCESSING ERROR:", e);
      }
    });
    return;
  }

  res.writeHead(200);
  res.end('Ava Engine Active.');
});

server.listen(PORT, () => console.log('Ava live on port ' + PORT));
