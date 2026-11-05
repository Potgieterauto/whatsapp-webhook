const http=require('http'),https=require('https'),url=require('url');
const {GoogleSpreadsheet}=require('google-spreadsheet');
const {JWT}=require('google-auth-library');
const PORT=process.env.PORT||3000, VERIFY_TOKEN=process.env.VERIFY_TOKEN||'Potgieterauto';
const WHATSAPP_TOKEN=process.env.WHATSAPP_TOKEN, PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY, SPREADSHEET_ID=process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY=process.env.GOOGLE_PRIVATE_KEY?process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/"/g,'').trim():undefined;
const MAKE_WEBHOOK_URL=process.env.MAKE_WEBHOOK_URL;
const conversations={};

let currentSystemPrompt=`You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out:
1. Their budget
2. Whether they want new or used
3. Their preferred make or model
4. Confirm their name and best contact number

Once you have all this info, thank them warmly and explicitly use the phrase "a consultant will call you soon" so the backend knows they are ready.
Keep messages short and conversational. Use emojis occasionally. Speak naturally like a real South African salesperson.`;

function cleanHistoryForGemini(history){
  let clean=[], expected='user';
  for(const msg of history){
    if(!msg||!msg.content||typeof msg.content!=='string'||msg.content.trim()==='') continue;
    let role=msg.role==='assistant'?'model':'user';
    if(role===expected){ clean.push({role,parts:[{text:msg.content}]}); expected=expected==='user'?'model':'user'; }
    else if(role==='user'&&expected==='model'){ if(clean.length>0) clean[clean.length-1].parts[0].text+=`\n${msg.content}`; }
  } return clean;
}

async function saveToGoogleSheets(phone,name,rawHistory,extractedData=null){
  try{
    if(!SPREADSHEET_ID||!GOOGLE_SERVICE_ACCOUNT_EMAIL||!GOOGLE_PRIVATE_KEY) return;
    const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
    const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
    const clientSheet=doc.sheetsByTitle['Clients']||doc.sheetsByIndex[0], logSheet=doc.sheetsByTitle['Chat Logs'];
    const clientRows=await clientSheet.getRows(), ts=new Date().toLocaleString('en-ZA',{timeZone:'Africa/Johannesburg'});
    const lastMsg=rawHistory[rawHistory.length-1], txt=lastMsg?.content||"", exRow=clientRows.find(r=>String(r.get('Phone'))===String(phone));
    if(exRow){
      let up={'Date':ts};
      if(extractedData){
        if(extractedData.name&&extractedData.name!=="Unknown") up['Name']=extractedData.name;
        if(extractedData.vehicle&&extractedData.vehicle!=="Unknown") up['Vehicle']=extractedData.vehicle;
        if(extractedData.condition&&extractedData.condition!=="Unknown") up['Condition']=extractedData.condition;
        if(extractedData.budget&&extractedData.budget!=="Unknown") up['Budget']=extractedData.budget;
        if(extractedData.tier) up['Tier']=extractedData.tier;
      } else if(name&&(!exRow.get('Name')||exRow.get('Name')==='Unknown')) up['Name']=name;
      exRow.assign(up); await exRow.save();
    } else {
      await clientSheet.addRow({'Date':ts,'Name':extractedData?.name||name||'Unknown','Phone':phone,'Vehicle':extractedData?.vehicle||'Unknown','Condition':extractedData?.condition||'Unknown','Budget':extractedData?.budget||'Unknown','Tier':extractedData?.tier||'Warm'});
    }
    if(logSheet&&lastMsg){
      const logRows=await logSheet.getRows(), exLog=logRows.find(r=>String(r.get('Phone'))===String(phone));
      const lbl=lastMsg.role==='assistant'?'Ava':'Client', fTxt=`[${lbl}]: ${txt}`;
      if(exLog){ exLog.assign({'Timestamp':ts,'Sender':lbl,'Message':exLog.get('Message')?`${exLog.get('Message')} | ${fTxt}`:fTxt}); await exLog.save(); }
      else { await logSheet.addRow({'Timestamp':ts,'Phone':phone,'Sender':lbl,'Message':fTxt}); }
    }
  }catch(e){console.error(e.message);}
}

async function fetchLeadsFromGoogleSheets(){
  try{
    if(!SPREADSHEET_ID) return [];
    const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
    const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
    const rows=await (doc.sheetsByTitle['Clients']||doc.sheetsByIndex[0]).getRows();
    return rows.map(r=>({timestamp:r.get('Date')||'',name:r.get('Name')||'Unknown',phone:r.get('Phone')||'',vehicle:r.get('Vehicle')||'Unknown',condition:r.get('Condition')||'Unknown',budget:r.get('Budget')||'Unknown',tier:r.get('Tier')||'Warm'}));
  }catch(e){return [];}
}

async function extractLeadDetails(history){
  const p=`Analyze conversation. Extract JSON. Fields: name, vehicle, condition (New/Used/Demo/Unknown), budget, tier (Hot/Warm/Cold). Unknown if missing. Return raw JSON.`;
  const contents=cleanHistoryForGemini(history); if(!contents.length) return null;
  return new Promise(r=>{
    const req=https.request({hostname:'generativelanguage.googleapis.com',path:`/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{try{r(JSON.parse(JSON.parse(b).candidates[0].content.parts[0].text.trim()));}catch(e){r(null);}});
    }); req.on('error',()=>r(null)); req.write(JSON.stringify({contents,systemInstruction:{parts:[{text:p}]},generationConfig:{responseMimeType:"application/json"}})); req.end();
  });
}

function sendWhatsAppMessage(to,msg,tmpl=null){
  if(!WHATSAPP_TOKEN) return;
  const d=JSON.stringify(tmpl?{messaging_product:'whatsapp',to,type:'template',template:{name:tmpl,language:{code:'en_US'}}}:{messaging_product:'whatsapp',to,type:'text',text:{body:msg}});
  const req=https.request({hostname:'graph.facebook.com',path:`/v17.0/${PHONE_NUMBER_ID}/messages`,method:'POST',headers:{'Authorization':`Bearer ${WHATSAPP_TOKEN}`,'Content-Type':'application/json'}});
  req.on('error',()=>{}); req.write(d); req.end();
}

function sendToMake(data){
  if(!MAKE_WEBHOOK_URL) return;
  try{const u=new URL(MAKE_WEBHOOK_URL), req=https.request({hostname:u.hostname,path:u.pathname,method:'POST',headers:{'Content-Type':'application/json'}}); req.on('error',()=>{}); req.write(JSON.stringify(data)); req.end();}catch(e){}
}

async function getAIResponse(history){
  const data=JSON.stringify({contents:cleanHistoryForGemini(history),systemInstruction:{parts:[{text:currentSystemPrompt}]},generationConfig:{maxOutputTokens:512}});
  return new Promise(r=>{
    const req=https.request({hostname:'generativelanguage.googleapis.com',path:`/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{try{const txt=JSON.parse(b).candidates[0].content.parts[0].text; r(txt?txt.trim():"Let me check that.");}catch(e){r("I am checking that info now.");}});
    }); req.on('error',()=>r("Let me look into that.")); req.write(data); req.end();
  });
}

const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204); return res.end();}
  const pUrl=url.parse(req.url,true);
  if(pUrl.pathname==='/api/leads'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(await fetchLeadsFromGoogleSheets()));}
  if(pUrl.pathname==='/api/contacts'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify({conversations}));}
  if(pUrl.pathname==='/api/send-message'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
      try{const p=JSON.parse(b); if(p.phone){sendWhatsAppMessage(p.phone,p.message||'',p.useTemplate?(p.templateName||'hello_world'):null); if(!conversations[p.phone])conversations[p.phone]={name:"Manual",phone:p.phone,messages:[],lastUpdated:new Date().toISOString()}; if(p.message){conversations[p.phone].messages.push({role:'assistant',content:p.message}); conversations[p.phone].lastUpdated=new Date().toISOString();} res.writeHead(200); res.end(JSON.stringify({success:true}));}else{res.writeHead(400);res.end(JSON.stringify({success:false}));}}catch(e){res.writeHead(400);res.end();}
    }); return;
  }
  if(pUrl.pathname==='/webhook'&&req.method==='GET'){const m=pUrl.query['hub.mode'],t=pUrl.query['hub.verify_token'],c=pUrl.query['hub.challenge']; if(m==='subscribe'&&t===VERIFY_TOKEN){res.writeHead(200);res.end(c);}else{res.writeHead(403);res.end();} return;}
  if(pUrl.pathname==='/webhook'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
      res.writeHead(200); res.end('OK');
      try{const p=JSON.parse(b), m=p.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; if(m&&m.type==='text'){
        const f=m.from, t=m.text.body, n=p.entry[0].changes[0].value.contacts[0].profile.name||'there';
        if(!conversations[f])conversations[f]={name:n,phone:f,messages:[],lastUpdated:new Date().toISOString()}; conversations[f].messages.push({role:'user',content:t}); conversations[f].lastUpdated=new Date().toISOString();
        const rep=await getAIResponse(conversations[f].messages); conversations[f].messages.push({role:'assistant',content:rep}); sendWhatsAppMessage(f,rep);
        (async()=>{try{let ex=null, uc=conversations[f].messages.filter(x=>x.role==='user').length; if(uc>=2&&uc%2===0)ex=await extractLeadDetails(conversations[f].messages); await saveToGoogleSheets(f,n,conversations[f].messages,ex); sendToMake({name:n,phone:f,last_message:t,ai_response:rep,timestamp:new Date().toISOString()});}catch(e){}})();
      }}catch(e){}
    }); return;
  }
  res.writeHead(200); res.end('Ava Engine Active');
});

server.listen(PORT,()=>console.log('Ava live port '+PORT));
// --- END OF FILE ---
