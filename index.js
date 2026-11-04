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

let currentSystemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and explicitly use the phrase "a consultant will call you soon" so the backend knows they are ready.
Keep messages short and conversational. Use emojis occasionally. Speak naturally like a real South African salesperson.`;

const knowledgeBaseDocuments = [];

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
      const formattedLogText = `[${senderLabel}]:${latestText}`;

      if (existingLogRow) {
        const currentMessages = existingLogRow.get('Message') || "";
        existingLogRow.assign({
          'Timestamp': timestamp,
          'Sender': senderLabel,
          'Message': currentMessages ? `${currentMessages} \vert{}${formattedLogText}` : formattedLogText
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

// --- FETCH LEADS FROM GOOGLE SHEETS FOR THE DASHBOARD API ---
async function fetchLeadsFromGoogleSheets() {
  try {
    if (!SPREADSHEET_ID || !GOOGLE_SERVICE_ACCOUNT_EMAIL || !GOOGLE_PRIVATE_KEY) {
      return [];
    }

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
    console.error("ERROR FETCHING LEADS FROM SHEETS:", error.message);
    return [];
  }
}

// --- OPTIMIZED SMART EXTRACTION CALL ---
async function extractLeadDetails(history) {
  const analysisPrompt = `Analyze the conversation history between a car sales agent and a
