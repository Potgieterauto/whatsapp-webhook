async function getAIResponse(userMessage, history, userName) {
  console.log("ENTERED getAIResponse");
  
  const systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and tell them a consultant will call them soon.
Keep messages short and conversational. Use emojis occasionally. Never be pushy. Speak naturally like a real South African sales person.`;

  // Robust filtering: Ensures every history object has content and a valid string
  const validHistory = history.filter(msg => msg && typeof msg.content === 'string' && msg.content.trim() !== '');

  const geminiContents = validHistory.map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content }]
  }));

  // Emergency Fallback: If history filtering leaves it empty, seed it with the current message
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
