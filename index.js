if (parsedUrl.pathname === '/webhook' && req.method === 'POST') {

  console.log('WEBHOOK RECEIVED');

  let body = '';

  req.on('data', chunk => body += chunk);

  req.on('end', async () => {

    console.log('RAW BODY:', body);

    try {

      const payload = JSON.parse(body);

      console.log('PAYLOAD:', JSON.stringify(payload, null, 2));

      const entry = payload.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const message = value?.messages?.[0];

      if (!message) {
        console.log('No WhatsApp message found in payload');
        res.writeHead(200);
        res.end('OK');
        return;
      }

      console.log('MESSAGE FOUND');

      if (message.type === 'text') {

        const from = message.from;
        const text = message.text.body;
        const name = value.contacts?.[0]?.profile?.name || 'there';

        console.log('FROM:', from);
        console.log('NAME:', name);
        console.log('TEXT:', text);

        if (!conversations[from]) {
          conversations[from] = [];
        }

        const aiReply = await getAIResponse(
          text,
          conversations[from],
          name
        );

        console.log('AI REPLY:', aiReply);

        conversations[from].push({
          role: 'user',
          content: text
        });

        conversations[from].push({
          role: 'assistant',
          content: aiReply
        });

        sendWhatsAppMessage(from, aiReply);

        sendToMake({
          name: name,
          phone: from,
          last_message: text,
          ai_response: aiReply,
          timestamp: new Date().toISOString()
        });

        console.log('Message sent to WhatsApp');
        console.log('Lead sent to Make');
      }

    } catch (e) {

      console.error('WEBHOOK ERROR');
      console.error(e);

    }

    res.writeHead(200);
    res.end('OK');

  });

  return;
}
