const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Potgieterauto';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY = process.env.OPENAI_API_KEY;
console.log("API KEY EXISTS:", !!GEMINI_API_KEY);
console.log("API KEY STARTS WITH:", GEMINI_API_KEY?.substring(0,10));
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

const conversations = {};

function sendWhatsAppMessage(to, message) {
  console.log("SENDING TO:", to);
console.log("MESSAGE:", message);
console.log("PHONE_NUMBER_ID:", PHONE_NUMBER_ID);
console.log("TOKEN EXISTS:", !!WHATSAPP_TOKEN);
  
const data = JSON.stringify({
  model: "mistralai/mistral-7b-instruct:free",
  messages: [
    {
      role: "system",
      content: systemPrompt
    },
    ...history.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    {
      role: "user",
      content: userMessage
    }
  ]
});

return new Promise((resolve) => {

  const options = {
    hostname: 'openrouter.ai',
    path: '/api/v1/chat/completions',
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${GEMINI_API_KEY}`,
      'Content-Type': 'application/json'
    }
  };

  const req = https.request(options, (res) => {
    let body = '';

    res.on('data', chunk => body += chunk);

    res.on('end', () => {

      console.log("OPENROUTER RESPONSE:", body);

      try {
        const parsed = JSON.parse(body);
        resolve(parsed.choices[0].message.content);
      } catch (e) {
        console.log("OPENROUTER PARSE ERROR:", e);
        console.log("OPENROUTER RAW RESPONSE:", body);
        resolve("Sorry, I'm having trouble right now.");
      }

    });
  });

  req.on('error', (err) => {
    console.log("OPENROUTER ERROR:", err);
    resolve("Sorry, I'm having trouble right now.");
  });

  req.write(data);
  req.end();

});
}

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

async function getAIResponse(userMessage, history, userName) {
  const systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and tell them a consultant will call them soon.
Keep messages short and conversational. Use emojis occasionally. Never be pushy. Speak naturally like a real South African sales person.`;

  const contents = [];
  
  for (const msg of history) {
    contents.push({
      role: msg.role === 'assistant' ? 'model' : 'user',
      parts: [{ text: msg.content }]
    });
  }
  
  contents.push({ role: 'user', parts: [{ text: userMessage }] });

 const data = JSON.stringify({
  model: "mistralai/mistral-7b-instruct:free",
  messages: [
    {
      role: "system",
      content: systemPrompt
    },
    ...history.map(msg => ({
      role: msg.role,
      content: msg.content
    })),
    {
      role: "user",
      content: userMessage
    }
  ]
});

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
     res.on('end', () => {

  console.log("GEMINI RESPONSE:", body);

 try {
  const parsed = JSON.parse(body);
  resolve(parsed.choices[0].message.content);
} catch (e) {
  console.log("GEMINI PARSE ERROR:", e);
  console.log("GEMINI RAW RESPONSE:", body);
  resolve("ERROR");
}
      });
      
    req.on('error', () => resolve("Hi! I'm Ava from Potgieter Auto. How can I help you find your perfect car today? 🚗"));
    req.write(data);
    req.end();
  });
}

const server = http.createServer(async (req, res) => {

  console.log(req.method, req.url);

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

  console.log('RAW BODY:', body);

 
      try {
        const payload = JSON.parse(body);
        const entry = payload.entry?.[0];
        const change = entry?.changes?.[0];
        const value = change?.value;
        const message = value?.messages?.[0];
        
console.log("MESSAGE OBJECT:", message);
        
        if (message && message.type === 'text') {
          console.log("TEXT MESSAGE DETECTED");
          const from = message.from;
          const text = message.text.body;
          const name = value.contacts?.[0]?.profile?.name || 'there';

          if (!conversations[from]) conversations[from] = [];
conversations[from].push({
  role: 'user',
  content: text
});
         const aiReply = await getAIResponse(text, conversations[from], name);

console.log('FROM:', from);
console.log('MESSAGE:', text);
console.log('AI REPLY:', aiReply);

          
          conversations[from].push({ role: 'assistant', content: aiReply });

          sendWhatsAppMessage(from, aiReply);

          sendToMake({
            name: name,
            phone: from,
            last_message: text,
            ai_response: aiReply,
            timestamp: new Date().toISOString()
          });
        }
      } catch (e) {}
      res.writeHead(200);
      res.end('OK');
    });
    return;
  }

  res.writeHead(200);
  res.end('Potgieter Auto Sales Bot - Ava is ready!');
});

server.listen(PORT, () => console.log('Ava is live on port ' + PORT));
