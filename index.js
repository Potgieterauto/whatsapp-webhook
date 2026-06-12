const http = require('http');
const https = require('https');
const url = require('url');

const PORT = process.env.PORT || 3000;
const VERIFY_TOKEN = process.env.VERIFY_TOKEN || 'Potgieterauto';
const WHATSAPP_TOKEN = process.env.WHATSAPP_TOKEN;
const PHONE_NUMBER_ID = process.env.PHONE_NUMBER_ID;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const MAKE_WEBHOOK_URL = process.env.MAKE_WEBHOOK_URL;

const conversations = {};

function sendWhatsAppMessage(to, message) {
  const data = JSON.stringify({
    messaging_product: 'whatsapp',
    to: to,
    type: 'text',
    text: { body: message }
  });

  const options = {
    hostname: 'graph.facebook.com',
    path: `/v18.0/${PHONE_NUMBER_ID}/messages`,
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${WHATSAPP_TOKEN}`,
      'Content-Type': 'application/json'
    }
  };

  const req = https.request(options);
  req.write(data);
  req.end();
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

async function getAIResponse(userMessage, history) {
  const systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Their contact details (name and phone)

Once you have all this info, summarize it and tell them a consultant will call them soon.
Rate the lead as HOT (ready to buy), WARM (interested but not urgent), or COLD (just browsing).
Keep messages short and conversational. Use emojis occasionally. Never be pushy.`;

  const messages = [...history, { role: 'user', content: userMessage }];

  const data = JSON.stringify({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: messages
  });

  return new Promise((resolve) => {
    const options = {
      hostname: 'api.anthropic.com',
      path: '/v1/messages',
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_API_KEY,
        'anthropic-version': '2023-06-01',
        'Content-Type': 'application/json'
      }
    };

    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(body);
          resolve(parsed.content[0].text);
        } catch (e) {
          resolve("Hi! I'm Ava from Potgieter Auto. How can I help you find your perfect car today? 🚗");
        }
      });
    });

    req.on('error', () => resolve("Hi! I'm Ava from Potgieter Auto. How can I help you find your perfect car today? 🚗"));
    req.write(data);
    req.end();
  });
}

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
          
          const aiReply = await getAIResponse(text, conversations[from]);
          
          conversations[from].push({ role: 'user', content: text });
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
  res.end('Potgieter Auto Sales Bot Running');
});

server.listen(PORT, () => console.log('Ava is live on port ' + PORT));
