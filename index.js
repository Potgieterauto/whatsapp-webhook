const http=require('http'),https=require('https'),url=require('url');
const {GoogleSpreadsheet}=require('google-spreadsheet');
const {JWT}=require('google-auth-library');

const PORT=process.env.PORT||3000, VERIFY_TOKEN=process.env.VERIFY_TOKEN||'Potgieterauto';
const WHATSAPP_TOKEN=process.env.WHATSAPP_TOKEN, PHONE_NUMBER_ID=process.env.PHONE_NUMBER_ID, WABA_ID=process.env.WABA_ID;
const GEMINI_API_KEY=process.env.GEMINI_API_KEY, SPREADSHEET_ID=process.env.SPREADSHEET_ID;
const GOOGLE_SERVICE_ACCOUNT_EMAIL=process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL;
const GOOGLE_PRIVATE_KEY=process.env.GOOGLE_PRIVATE_KEY?process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g,'\n').replace(/"/g,'').trim():undefined;
const MAKE_WEBHOOK_URL=process.env.MAKE_WEBHOOK_URL;

class AvaDB {
  constructor() {
    this.leads = {};
    this.conversations = {};
    this.systemPrompt = `You are Ava, an elite, highly professional senior car sales executive at Potgieter Auto, a premier dealership in South Africa. You specialize in new and pre-owned vehicles (including Omoda, Jaecoo, VW, Ford, and curated premium imports). Your objective is to qualify inbound leads naturally and conversationally. Gather their preferred make/model, new/used condition, budget/financing preference, and contact name/number. Keep responses punchy, warm, and professional with light local South African context. Once all details are gathered, explicitly use the exact phrase "A consultant will call you soon" so our management system logs them as ready for handover.`;
  }

  async bootFromCloud() {
    console.log("Booting Ava App Engine... Syncing from Cloud Backup.");
    try {
      if(!SPREADSHEET_ID) return console.log("No Sheets ID. Running local-only mode.");
      const auth=new JWT({email:GOOGLE_SERVICE_ACCOUNT_EMAIL,key:GOOGLE_PRIVATE_KEY,scopes:['https://www.googleapis.com/auth/spreadsheets']});
      const doc=new GoogleSpreadsheet(SPREADSHEET_ID,auth); await doc.loadInfo();
      const clientSheet=doc.sheetsByTitle['Clients']||doc.sheetsByIndex[0];
      const logSheet=doc.sheetsByTitle['Chat Logs'];
      
      if(clientSheet){
        const rows=await clientSheet.getRows();
        rows.forEach(r=>{
          this.leads[r.get('Phone')] = { timestamp:r.get('Date'), name:r.get('Name'), phone:r.get('Phone'), vehicle:r.get('Vehicle'), condition:r.get('Condition'), budget:r.get('Budget'), tier:r.get('Tier')||'Warm' };
        });
      }
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
      console.log("Database loaded successfully into RAM.");
    } catch(e) { console.error("Cloud boot failed:", e.message); }
  }

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
db.bootFromCloud();

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

const server=http.createServer(async(req,res)=>{
  res.setHeader('Access-Control-Allow-Origin','*'); res.setHeader('Access-Control-Allow-Methods','GET, POST, OPTIONS'); res.setHeader('Access-Control-Allow-Headers','Content-Type, Authorization');
  if(req.method==='OPTIONS'){res.writeHead(204); return res.end();}
  const pUrl=url.parse(req.url,true);
  
  if(pUrl.pathname==='/api/leads'&&req.method==='GET'){res.writeHead(200,{'Content-Type':'application/json'}); return res.end(JSON.stringify(Object.values
