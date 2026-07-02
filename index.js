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

// Helper utility to make sure history array structure alternates perfectly for Gemini
function cleanHistoryForGemini(history) {
  const clean = [];
  let expectedRole = 'user';

  for (const msg of history) {
    if (!msg || !msg.content || msg.content.trim() === '') continue;
    
    // Map internal roles to Gemini structure standards
    const currentRole = msg.role === 'assistant' ? 'model' : 'user';

    if (currentRole === expectedRole) {
      clean.push({
        role: currentRole,
        parts: [{ text: msg.content }]
      });
      // Alternate requirement
      expectedRole = expectedRole === 'user' ? 'model' : 'user';
    } else if (currentRole === 'user' && expectedRole === 'model') {
      // If client texts twice in a row, combine messages instead of breaking the schema
      if (clean.length > 0) {
        clean[clean.length - 1].parts[0].text += `\n${msg.content}`;
      }
    }
  }
  return clean;
}

// --- SAVE OR UPDATE ROW PER CLIENT (SPLIT-SHEET MECHANISM) ---
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

    if (!logSheet) {
      console.log("SHEETS WARNING: Tab named 'Chat Logs' missing. Check tab titles.");
    }

    const rows = await clientSheet.getRows();
    const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });
    
    const latestMessageObj = rawHistory[rawHistory.length - 1];
    const latestText = latestMessageObj?.content || "";

    const existingRow = rows.find(row => String(row.get('Phone')) === String(phone));

    // 1. CRM SUMMARY ENTRY LOGIC (TAB 1)
    if (existingRow) {
      console.log(`SHEETS: Updating CRM entry for user: ${phone}`);
      const updatePayload = { 'Date': timestamp };

      if (extractedData) {
        if (extractedData.name && extractedData.name !== "Unknown") updatePayload['Name'] = extractedData.name;
        if (extractedData.vehicle && extractedData.vehicle !== "Unknown") updatePayload['Vehicle'] = extractedData.vehicle;
        if (extractedData.condition && extractedData.condition !== "Unknown") updatePayload['Condition'] = extractedData.condition;
        if (extractedData.budget && extractedData.budget !== "Unknown") updatePayload['Budget'] = extractedData.budget;
        if (extractedData.tier) updatePayload['Tier'] = extractedData.tier; 
      } else if (name && (!existingRow.get('Name') || existingRow.get('Name') === 'Unknown')) {
        updatePayload['Name'] = name;
      }

      existingRow.assign(updatePayload);
      await existingRow.save();
    } else {
      console.log(`SHEETS: Adding brand new CRM row for: ${phone}`);
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

    // 2. LIVE CHAT LEDGER APPEND TICKER (TAB 2)
    if (logSheet && latestMessageObj) {
      await logSheet.addRow({
        'Timestamp': timestamp,
        'Phone': phone,
        'Sender': latestMessageObj.role === 'assistant' ? 'Ava' : 'Client',
        'Message': latestText
      });
    }

  } catch (error) {
    console.error("SHEETS ERROR: Failed row execution:", error);
  }
}

// --- OPTIMIZED SMART EXTRACTION CALL ---
async function extractLeadDetails(history) {
  console.log("RUNNING LEAD ANALYSIS AND TIERING...");
  
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

  const data = JSON.stringify({
    contents: geminiContents,
    systemInstruction: { parts: [{ text: analysisPrompt }] },
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
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.write(data);
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
  req
