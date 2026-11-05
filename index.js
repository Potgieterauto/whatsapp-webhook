const http=require('http'),https=require('https'),url=require('url'),fs=require('fs');
const {GoogleSpreadsheet}=require('google-spreadsheet');
const {JWT}=require('google-auth-library');

const PORT=process.env.PORT||3000, VERIFY_TOKEN=process.env.VERIFY_TOKEN||'Potgieterauto';
const WHATSAPP_TOKEN=process.env.WHATSAPP_TOKEN, PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID, WABA_ID=process.env.WABA_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY, SPREADSHEET_ID=process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY=process.env.GOOGLE_PRIVATE_KEY?process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/"/g,'').trim():undefined;
const MAKE_WEBHOOK_URL=process.env.MAKE_WEBHOOK_URL;

// ==========================================
// INTERNAL APP DATABASE ENGINE
// ==========================================
class AvaDB {
  constructor() {
    this.leads = {}; // phone -> lead details
    this.conversations = {}; // phone -> chat history
    this.systemPrompt = `You are Ava, an expert car sales agent at Potgieter Auto, a dealership in South Africa selling new and used vehicles. You are friendly, professional, and helpful. Your goal is to qualify leads by finding out: 1. Budget 2. New/Used 3. Make/Model 4. Name/Contact. Once you have all info, say "a consultant will call you soon". Keep messages short. Speak naturally like a South African salesperson.`;
  }

  async bootFromCloud() {
    console.log("Booting Ava Engine... Syncing from Cloud Backup (Google Sheets).");
    try {
      if(!SPREADSHEET_ID) return console.log("No Sheets ID. Running in local-only mode.");
      const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
      const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
      
      const clientSheet=doc.sheetsByTitle['Clients']||doc.sheetsByIndex[0];
      const logSheet=doc.sheetsByTitle['Chat Logs'];
      
      // Load Leads
      if(clientSheet){
        const rows=await clientSheet.getRows();
        rows.forEach(r=>{
          this.leads[r.get('Phone')] = { timestamp:r.get('Date'), name:r.get('Name'), phone:r.get('Phone'), vehicle:r.get('Vehicle'), condition:r.get('Condition'), budget:r.get('Budget'), tier:r.get('Tier')||'Warm' };
        });
      }
      
      // Load Chats
      if(logSheet){
        const rows=await logSheet.getRows();
        rows.forEach(r=>{
          const phone=r.get('Phone'), msgText=r.get('Message');
          if(phone && msgText){
            if(!this.conversations[phone]) this.conversations[phone]={name:this.leads[phone]?.name||r.get('Name')||'Client', phone, messages:[], lastUpdated:r.get('Timestamp')||new Date().toISOString()};
            const splitMsgs=msgText.split('|');
            splitMsgs.forEach(m=>{
              const txt=m.trim();
              if(txt.startsWith('[Ava]:')) this.conversations[phone].messages.push({role:'assistant',content:txt.replace('[Ava]:','').trim()});
              else if(txt.startsWith('[Client]:')) this.conversations[phone].messages.push({role:'user',content:txt.replace('[Client]:','').trim()});
            });
          }
        });
      }
      console.log("Boot sequence complete. Database loaded into RAM.");
    } catch(e) { console.error("Cloud boot failed, running fresh:", e.message); }
  }

  // Background Cloud Sync
  async syncLeadToCloud(phone) {
    if(!SPREADSHEET_ID) return;
    try {
      const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
      const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
      const clientSheet=doc.sheetsByTitle['Clients']||doc.sheetsByIndex[0];
      const rows=await clientSheet.getRows(); const row=rows.find(r=>String(r.get('Phone'))===String(phone));
      const lead = this.leads[phone];
      if(row){ row.assign({'Date':lead.timestamp, 'Name':lead.name, 'Vehicle':lead.vehicle, 'Condition':lead.condition, 'Budget':lead.budget, 'Tier':lead.tier}); await row.save(); }
      else { await clientSheet.addRow({'Date':lead.timestamp,'Name':lead.name,'Phone':phone,'Vehicle':lead.vehicle,'Condition':lead.condition,'Budget':lead.budget,'Tier':lead.tier}); }
    } catch(e){}
  }

  async syncChatToCloud(phone) {
    if(!SPREADSHEET_ID) return;
    try {
      const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
      const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
      const logSheet=doc.sheetsByTitle['Chat Logs']; if(!logSheet) return;
      const rows=await logSheet.getRows(); const row=rows.find(r=>String(r.get('Phone'))===String(phone));
      const chat = this.conversations[phone];
      if(!chat || chat.messages.length===0) return;
      
      const lastMsg = chat.messages[chat.messages.length-1];
      const lbl = lastMsg.role==='assistant'?'Ava':'Client';
      const fTxt = `[${lbl}]: ${lastMsg.content}`;
      
      if(row){ row.assign({'Timestamp':chat.lastUpdated, 'Sender':lbl, 'Message':row.get('Message')?`${row.get('Message')} | ${fTxt}`:fTxt}); await row.save(); }
      else { await logSheet.addRow({'Timestamp':chat.lastUpdated,'Phone':phone,'Sender':lbl,'Message':fTxt}); }
    } catch(e){}
  }
}

const db = new AvaDB();
db.bootFromCloud(); // Initialize Database

// ==========================================
// CORE FUNCTIONS
// ==========================================
function cleanHistoryForGemini(history){
  let clean=[], expected='user';
  for(const msg of history){
    if(!msg||!msg.content||typeof msg.content!=='string'||msg.content.trim()==='') continue;
    let role=msg.role==='assistant'?'model':'user';
    if(role===expected){ clean.push({role,parts:[{text:msg.content}]}); expected=expected==='user'?'model':'user'; }
    else if(role==='user'&&expected==='model'){ if(clean.length>0) clean[clean.length-1].parts[0].text+=`\n${msg.content}`; }
  } return clean;
}

async function extractLeadDetails(history){
  const p=`Analyze conversation. Extract JSON. Fields: name, vehicle, condition (New/Used/Demo/Unknown), budget, tier (Hot/Warm/Cold). Unknown if missing. Raw JSON only.`;
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

async function getAIResponse(history){
  const data=JSON.stringify({contents:cleanHistoryForGemini(history),systemInstruction:{parts:[{text:db.systemPrompt}]},generationConfig:{maxOutputTokens:512}});
  return new Promise(r=>{
    const req=https.request({hostname:'generativelanguage.googleapis.com',path:`/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,method:'POST',headers:{'Content-Type':'application/json'}},res=>{
      let b=''; res.on('data',c=>b+=c); res.on('end',()=>{try{const txt=JSON.parse(b).candidates[0].content.parts[0].text; r(txt?txt.trim():"Let me check that.");}catch(e){r("I am checking that info now.");}});
    }); req.on('error',()=>r("Let me look into that.")); req.write(data); req.end();
  });
}

// ==========================================
// HTTP SERVER & API ROUTES
// ==========================================
const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204); return res.end();}
  const pUrl=url.parse(req.url,true);
  
  // FAST READS (Served directly from RAM)
  if(pUrl.pathname==='/api/leads'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'}); 
    return res.end(JSON.stringify(Object.values(db.leads).reverse()));
  }
  
  if(pUrl.pathname==='/api/contacts'&&req.method==='GET'){
    res.writeHead(200,{'Content-Type':'application/json'}); 
    return res.end(JSON.stringify({conversations: db.conversations}));
  }
  
  // FAST WRITES (Updates RAM instantly, syncs to cloud in background)
  if(pUrl.pathname==='/api/update-lead'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
      try{
        const p=JSON.parse(b); 
        if(db.leads[p.phone]) {
          db.leads[p.phone].tier = p.tier; // Instant RAM update
          db.syncLeadToCloud(p.phone); // Background task
          res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true}));
        } else { res.writeHead(404); res.end(JSON.stringify({success:false, error:"Lead not found"})); }
      }catch(e){res.writeHead(400); res.end();}
    }); return;
  }

  // OUTBOUND MESSAGING
  if(pUrl.pathname==='/api/send-message'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
      try{
        const p=JSON.parse(b); if(!p.phone) {res.writeHead(400); return res.end(JSON.stringify({success:false}));}
        sendWhatsAppMessage(p.phone,p.message||'',p.useTemplate?(p.templateName||'hello_world'):null); 
        
        if(!db.conversations[p.phone]) db.conversations[p.phone]={name:db.leads[p.phone]?.name||"Manual",phone:p.phone,messages:[],lastUpdated:new Date().toISOString()}; 
        if(p.message){
          db.conversations[p.phone].messages.push({role:'assistant',content:p.message}); 
          db.conversations[p.phone].lastUpdated=new Date().toISOString();
          db.syncChatToCloud(p.phone); // Background task
        } 
        res.writeHead(200); res.end(JSON.stringify({success:true}));
      }catch(e){res.writeHead(400);res.end();}
    }); return;
  }

  // META TEMPLATE CREATOR
  if(pUrl.pathname==='/api/create-template'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
      try{
        if(!WABA_ID){res.writeHead(400); return res.end(JSON.stringify({success:false,error:"WABA_ID environment variable missing"}));}
        const p=JSON.parse(b);
        const payload=JSON.stringify({name:p.name,language:"en_US",category:"MARKETING",components:[{type:"BODY",text:p.body}]});
        const reqMeta=https.request({hostname:'graph.facebook.com',path:`/v17.0/${WABA_ID}/message_templates`,method:'POST',headers:{'Authorization':`Bearer ${WHATSAPP_TOKEN}`,'Content-Type':'application/json'}},metaRes=>{
            let mb=''; metaRes.on('data',mc=>mb+=mc); metaRes.on('end',()=>{res.writeHead(200,{'Content-Type':'application/json'});res.end(mb);});
        }); reqMeta.on('error',()=>res.end(JSON.stringify({success:false}))); reqMeta.write(payload); reqMeta.end();
      }catch(e){res.writeHead(400); res.end();}
    }); return;
  }

  // SANDBOX & PROMPT
  if(pUrl.pathname==='/api/sandbox'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
      try{ const p=JSON.parse(b); const rep=await getAIResponse([{role:'user',content:p.message}]); res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({reply:rep})); }
      catch(e){ res.writeHead(400); res.end(); }
    }); return;
  }
  if(pUrl.pathname==='/api/prompt'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',()=>{
      try{ const p=JSON.parse(b); if(p.prompt) db.systemPrompt=p.prompt; res.writeHead(200,{'Content-Type':'application/json'}); res.end(JSON.stringify({success:true})); }
      catch(e){ res.writeHead(400); res.end(); }
    }); return;
  }

  // META WHATSAPP WEBHOOK (Inbound)
  if(pUrl.pathname==='/webhook'&&req.method==='GET'){const m=pUrl.query['hub.mode'],t=pUrl.query['hub.verify_token'],c=pUrl.query['hub.challenge']; if(m==='subscribe'&&t===VERIFY_TOKEN){res.writeHead(200);res.end(c);}else{res.writeHead(403);res.end();} return;}
  if(pUrl.pathname==='/webhook'&&req.method==='POST'){
    let b=''; req.on('data',c=>b+=c); req.on('end',async()=>{
      res.writeHead(200); res.end('OK'); // Acknowledge Meta instantly
      try{
        const p=JSON.parse(b), m=p.entry?.[0]?.changes?.[0]?.value?.messages?.[0]; 
        if(m&&m.type==='text'){
          const f=m.from, t=m.text.body, n=p.entry[0].changes[0].value.contacts[0].profile.name||'there';
          const ts=new Date().toISOString();
          
          if(!db.conversations[f]) db.conversations[f]={name:n,phone:f,messages:[],lastUpdated:ts}; 
          db.conversations[f].messages.push({role:'user',content:t}); 
          db.conversations[f].lastUpdated=ts;
          
          // Generate AI Reply
          const rep=await getAIResponse(db.conversations[f].messages); 
          db.conversations[f].messages.push({role:'assistant',content:rep}); 
          sendWhatsAppMessage(f,rep);

          // Asynchronous Data Processing
          (async()=>{
            try{
              // Sync Chat
              db.syncChatToCloud(f);
              // Extract Lead Info periodically
              let ex=null, uc=db.conversations[f].messages.filter(x=>x.role==='user').length; 
              if(uc>=2&&uc%2===0) {
                ex=await extractLeadDetails(db.conversations[f].messages); 
                if(ex) {
                  db.leads[f] = {timestamp:ts, name:ex.name||n, phone:f, vehicle:ex.vehicle||'Unknown', condition:ex.condition||'Unknown', budget:ex.budget||'Unknown', tier:ex.tier||'Warm'};
                  db.syncLeadToCloud(f);
                }
              }
            }catch(e){}
          })();
        }
      }catch(e){}
    }); return;
  }
  res.writeHead(200); res.end('Ava Engine Database Active');
});

server.listen(PORT,()=>console.log('Ava live port '+PORT));
// --- END OF FILE ---
