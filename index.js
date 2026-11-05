<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Potgieter Auto | Executive CRM</title>
    <style>
        :root {
            --bg-obsidian: #050505;
            --card-obsidian: #0c0c0e;
            --sidebar-obsidian: #09090b;
            --border-obsidian: #222226;
            --text-main: #f4f4f5;
            --text-muted: #a1a1aa;
            --accent-glow: rgba(255, 255, 255, 0.15);
            --accent-green: #10b981;
            --accent-blue: #3b82f6;
            --hover-bg: #18181b;
        }
        * { box-sizing: border-box; margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; }
        body { background-color: var(--bg-obsidian); color: var(--text-main); display: flex; height: 100vh; overflow: hidden; }
        
        .sidebar { width: 260px; background-color: var(--sidebar-obsidian); border-right: 1px solid var(--border-obsidian); display: flex; flex-direction: column; padding: 25px 0; }
        .brand { font-size: 18px; font-weight: 700; letter-spacing: 1px; padding: 0 25px 25px; border-bottom: 1px solid var(--border-obsidian); margin-bottom: 20px; color: var(--text-main); display: flex; align-items: center; gap: 10px; text-transform: uppercase; }
        .nav-btn { background: none; border: none; color: var(--text-muted); padding: 14px 25px; text-align: left; font-size: 14px; cursor: pointer; transition: 0.2s; display: flex; align-items: center; gap: 12px; width: 100%; font-weight: 500; }
        .nav-btn:hover { background-color: var(--hover-bg); color: var(--text-main); }
        .nav-btn.active { background-color: var(--hover-bg); color: #ffffff; border-left: 3px solid #ffffff; text-shadow: 0 0 10px rgba(255,255,255,0.4); }
        
        .main-content { flex: 1; padding: 40px; overflow-y: auto; }
        .page { display: none; animation: fadeIn 0.25s ease; }
        .page.active { display: block; }
        @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: translateY(0); } }
        
        h2 { margin-bottom: 25px; font-size: 26px; font-weight: 700; letter-spacing: -0.5px; border-bottom: 1px solid var(--border-obsidian); padding-bottom: 15px; text-shadow: 0 0 20px var(--accent-glow); }
        
        .card { background: var(--card-obsidian); border: 1px solid var(--border-obsidian); border-radius: 14px; padding: 25px; margin-bottom: 20px; box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .form-input, .form-select, .form-textarea { width: 100%; background: #050505; border: 1px solid var(--border-obsidian); color: var(--text-main); padding: 14px; border-radius: 8px; margin-bottom: 15px; outline: none; font-size: 14px; transition: 0.2s; }
        .form-input:focus, .form-select:focus, .form-textarea:focus { border-color: #52525b; box-shadow: 0 0 10px rgba(255,255,255,0.05); }
        .form-textarea { min-height: 120px; resize: vertical; }
        
        .btn { background: #f4f4f5; color: #09090b; padding: 12px 24px; border: none; border-radius: 8px; cursor: pointer; font-weight: 600; transition: 0.2s; }
        .btn:hover { background: #ffffff; box-shadow: 0 0 15px rgba(255,255,255,0.3); }
        .btn-green { background: var(--accent-green); color: #050505; }
        .btn-green:hover { background: #34d399; box-shadow: 0 0 15px rgba(16,185,129,0.4); }

        .filter-row { display: flex; gap: 12px; margin-bottom: 25px; flex-wrap: wrap; }
        .filter-pill { background: var(--card-obsidian); border: 1px solid var(--border-obsidian); color: var(--text-muted); padding: 8px 18px; border-radius: 30px; cursor: pointer; font-size: 13px; font-weight: 500; transition: 0.2s; }
        .filter-pill:hover, .filter-pill.active { background: #18181b; color: #ffffff; border-color: #52525b; text-shadow: 0 0 8px rgba(255,255,255,0.3); }
        
        table { width: 100%; border-collapse: collapse; text-align: left; font-size: 14px; }
        th { color: var(--text-muted); padding: 16px 12px; border-bottom: 1px solid var(--border-obsidian); font-weight: 600; text-transform: uppercase; font-size: 11px; letter-spacing: 0.5px; }
        td { padding: 16px 12px; border-bottom: 1px solid var(--border-obsidian); }
        .tier-select { background: #050505; border: 1px solid var(--border-obsidian); color: var(--text-main); padding: 6px 12px; border-radius: 6px; outline: none; cursor: pointer; font-weight: 600; font-size: 13px; }

        .chat-container { display: flex; height: calc(100vh - 140px); border: 1px solid var(--border-obsidian); border-radius: 14px; overflow: hidden; background: var(--card-obsidian); box-shadow: 0 10px 30px rgba(0,0,0,0.5); }
        .chat-sidebar { width: 320px; border-right: 1px solid var(--border-obsidian); background: var(--sidebar-obsidian); overflow-y: auto; }
        .chat-contact { padding: 18px; border-bottom: 1px solid var(--border-obsidian); cursor: pointer; transition: 0.2s; }
        .chat-contact:hover { background: var(--hover-bg); }
        .chat-main { flex: 1; display: flex; flex-direction: column; background: #050505; }
        .chat-history { flex: 1; padding: 25px; overflow-y: auto; display: flex; flex-direction: column; }
        .chat-input-area { padding: 20px; background: var(--card-obsidian); border-top: 1px solid var(--border-obsidian); display: flex; flex-direction: column; gap: 10px; }
        .chat-bottom-row { display: flex; gap: 10px; width: 100%; align-items: center; }
        
        /* HIGH CONTRAST BLACK & WHITE BUBBLES */
        .chat-bubble { padding: 12px 18px; border-radius: 10px; max-width: 65%; margin-bottom: 15px; font-size: 14px; line-height: 1.5; }
        .bubble-client { background: #ffffff; color: #050505; align-self: flex-start; border: 1px solid #e4e4e7; font-weight: 500; }
        .bubble-bot { background: #050505; color: #ffffff; align-self: flex-end; border: 1px solid #3f3f46; box-shadow: 0 0 15px rgba(255,255,255,0.05); }

        .meta-preview-box { background: #18181b; border: 1px dashed #3f3f46; padding: 15px; border-radius: 8px; margin-bottom: 15px; font-size: 13px; color: var(--text-muted); }
    </style>
</head>
<body>

    <div class="sidebar">
        <div class="brand">⚡ Potgieter Auto</div>
        <button class="nav-btn active" onclick="switchPage('page-leads', this)">📊 CRM Leads</button>
        <button class="nav-btn" onclick="switchPage('page-chat', this)">💬 Live WhatsApp</button>
        <button class="nav-btn" onclick="switchPage('page-bot', this)">🌿 Ava Decision Tree</button>
        <button class="nav-btn" onclick="switchPage('page-templates', this)">📄 Meta Templates</button>
        <button class="nav-btn" onclick="switchPage('page-sandbox', this)">🧪 Sandbox Testing</button>
    </div>

    <div class="main-content">
        
        <!-- PAGE 1: CRM -->
        <div id="page-leads" class="page active">
            <h2>Lead Pipeline & CRM</h2>
            <div class="filter-row">
                <div class="filter-pill active" onclick="filterLeads('All', this)">All Leads</div>
                <div class="filter-pill" onclick="filterLeads('Hot', this)">Hot Deals</div>
                <div class="filter-pill" onclick="filterLeads('Warm', this)">Warm</div>
                <div class="filter-pill" onclick="filterLeads('Cold', this)">No Deal</div>
            </div>
            <div class="card">
                <table>
                    <thead>
                        <tr>
                            <th>Date</th>
                            <th>Client Name</th>
                            <th>Phone</th>
                            <th>Vehicle Interest</th>
                            <th>Pipeline Stage</th>
                        </tr>
                    </thead>
                    <tbody id="crm-table-body">
                        <tr><td colspan="5" style="text-align:center; color: var(--text-muted);">Loading database...</td></tr>
                    </tbody>
                </table>
            </div>
        </div>

        <!-- PAGE 2: LIVE CHAT WITH HUMAN TAKEOVER & TEMPLATE SENDER -->
        <div id="page-chat" class="page">
            <h2>Live Client Conversations & Human Takeover</h2>
            <div class="chat-container">
                <div class="chat-sidebar" id="chat-list">
                    <div style="padding: 20px; color: var(--text-muted); text-align: center;">Syncing database...</div>
                </div>
                <div class="chat-main">
                    <div class="chat-history" id="chat-history-container">
                        <div style="text-align: center; color: var(--text-muted); margin-top: 60px;">Select a contact on the left to view conversation history.</div>
                    </div>
                    <div class="chat-input-area">
                        <div style="display: flex; justify-content: space-between; align-items: center; width: 100%; font-size: 12px; color: var(--text-muted);">
                            <span>🟢 <strong>Human Mode Active:</strong> Messages sent here go out as you directly to the client's WhatsApp.</span>
                            <div style="display: flex; gap: 8px; align-items: center;">
                                <select id="active-template-select" class="form-select" style="margin-bottom: 0; padding: 6px; font-size: 12px; width: 180px;">
                                    <option value="">Select Approved Template...</option>
                                </select>
                                <button class="btn" style="padding: 6px 12px; font-size: 12px;" onclick="sendTemplateToClient()">Send Template</button>
                            </div>
                        </div>
                        <div class="chat-bottom-row">
                            <input type="text" id="live-chat-input" class="form-input" style="margin-bottom: 0;" placeholder="Type message to reply as yourself...">
                            <button class="btn btn-green" onclick="sendLiveMessage()">Send as Human</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>

        <!-- PAGE 3: PHYSICAL TREE BRANCH BUILDER -->
        <div id="page-bot" class="page">
            <h2>Ava Conversational Decision Tree</h2>
            <div class="card">
                <p style="color: var(--text-muted); margin-bottom: 25px;">Visualizing how Ava's responses branch out sequentially. Edit any node below and save permanently to your SQLite database.</p>
                
                <div style="display: flex; flex-direction: column; align-items: center; gap: 15px;">
                    <div style="width: 100%; max-width: 700px; background: #0c0c0e; border: 1px solid var(--border-obsidian); border-radius: 12px; padding: 20px;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">🌱 Step 1: Initial Greeting</span>
                        <textarea id="flow-greeting" class="form-textarea" style="margin-top: 8px;"></textarea>
                    </div>
                    <div style="width: 3px; height: 25px; background: #3f3f46;"></div>
                    <div style="width: 100%; max-width: 700px; background: #0c0c0e; border: 1px solid var(--border-obsidian); border-radius: 12px; padding: 20px;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">🌿 Step 2: Condition Check (New / Demo)</span>
                        <textarea id="flow-branchNewUsed" class="form-textarea" style="margin-top: 8px;"></textarea>
                    </div>
                    <div style="width: 3px; height: 25px; background: #3f3f46;"></div>
                    <div style="width: 100%; max-width: 700px; background: #0c0c0e; border: 1px solid var(--border-obsidian); border-radius: 12px; padding: 20px;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">🌿 Step 3: Budget & Finance Qualification</span>
                        <textarea id="flow-branchBudget" class="form-textarea" style="margin-top: 8px;"></textarea>
                    </div>
                    <div style="width: 3px; height: 25px; background: #3f3f46;"></div>
                    <div style="width: 100%; max-width: 700px; background: #0c0c0e; border: 1px solid var(--border-obsidian); border-radius: 12px; padding: 20px;">
                        <span style="font-size: 12px; font-weight: 700; color: var(--text-muted); text-transform: uppercase;">🌳 Step 4: Closing Handover Trigger</span>
                        <textarea id="flow-closing" class="form-textarea" style="margin-top: 8px;"></textarea>
                    </div>
                </div>

                <div style="text-align: center; margin-top: 30px;">
                    <button class="btn btn-green" onclick="saveFlowTree()">💾 Save Decision Tree Permanently</button>
                </div>
            </div>
        </div>

        <!-- PAGE 4: EXACT META MANAGER TEMPLATE CREATOR -->
        <div id="page-templates" class="page">
            <h2>WhatsApp Template Manager (Meta Business Suite Style)</h2>
            <div class="card">
                <p style="color: var(--text-muted); margin-bottom: 20px;">Create and submit message templates matching Meta's exact specifications for high-volume outreach or re-engaging leads past the 24-hour window.</p>
                
                <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">TEMPLATE NAME</label>
                <input type="text" id="meta-tmpl-name" class="form-input" placeholder="e.g. omoda_weekend_special (lowercase, underscores only)">

                <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 15px;">
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">CATEGORY</label>
                        <select id="meta-tmpl-category" class="form-select">
                            <option value="MARKETING">Marketing (Promotions, Offers)</option>
                            <option value="UTILITY">Utility (Account updates, Confirmations)</option>
                            <option value="AUTHENTICATION">Authentication (OTP codes)</option>
                        </select>
                    </div>
                    <div>
                        <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">LANGUAGE</label>
                        <select id="meta-tmpl-lang" class="form-select">
                            <option value="en_US">English (US)</option>
                            <option value="en_ZA">English (South Africa)</option>
                        </select>
                    </div>
                </div>

                <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">HEADER TYPE (Optional)</label>
                <select id="meta-tmpl-header-type" class="form-select">
                    <option value="NONE">None</option>
                    <option value="TEXT">Text</option>
                    <option value="IMAGE">Image Media</option>
                </select>

                <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">BODY CONTENT (Use {{1}}, {{2}} for dynamic customer parameters)</label>
                <textarea id="meta-tmpl-body" class="form-textarea" placeholder="Hello {{1}}, we noticed you were looking at the {{2}}. Would you like to schedule a test drive this week?"></textarea>

                <label style="font-size: 12px; font-weight: bold; color: var(--text-muted);">FOOTER (Optional)</label>
                <input type="text" id="meta-tmpl-footer" class="form-input" placeholder="Potgieter Auto Hatfield">

                <div class="meta-preview-box">
                    <strong>ℹ️ Meta Submission Guidelines:</strong> Templates are reviewed by Meta automated systems. Avoid promotional spam keywords and ensure variables map to valid lead attributes.
                </div>

                <button class="btn btn-green" onclick="submitMetaTemplate()">Submit Template to Meta API</button>
            </div>
        </div>

        <!-- PAGE 5: SANDBOX -->
        <div id="page-sandbox" class="page">
            <h2>Ava Test Sandbox</h2>
            <div class="card" style="height: 60vh; display: flex; flex-direction: column;">
                <div id="sandbox-chat" style="flex: 1; background: #050505; border-radius: 10px; padding: 20px; margin-bottom: 15px; border: 1px solid var(--border-obsidian); overflow-y: auto;">
                    <p style="color: var(--text-muted); text-align: center; margin-top: 40px;">Test Ava here securely against your decision tree branches.</p>
                </div>
                <div style="display: flex; gap: 12px;">
                    <input type="text" id="sandbox-input" class="form-input" style="margin-bottom: 0;" placeholder="Send test message to Ava...">
                    <button class="btn btn-green" onclick="sendSandbox()">Send</button>
                </div>
            </div>
        </div>

    </div>

    <script>
        const backendUrl = window.VITE_BACKEND_URL || "https://whatsapp-webhook-fp3x.onrender.com";
        let chatData = {};
        let activeChatPhone = null;
        let approvedTemplates = ["hello_world", "omoda_special_dec", "finance_followup"];

        function switchPage(pageId, btnElement) {
            document.querySelectorAll('.page').forEach(page => page.classList.remove('active'));
            document.querySelectorAll('.nav-btn').forEach(btn => btn.classList.remove('active'));
            document.getElementById(pageId).classList.add('active');
            btnElement.classList.add('active');
            if (pageId === 'page-leads') loadLeads();
            if (pageId === 'page-chat') { loadLiveChats(); populateTemplateDropdown(); }
            if (pageId === 'page-bot') loadFlowTree();
        }

        function populateTemplateDropdown() {
            const select = document.getElementById('active-template-select');
            select.innerHTML = `<option value="">Select Approved Template...</option>` + 
                approvedTemplates.map(t => `<option value="${t}">${t}</option>`).join('');
        }

        function loadFlowTree() {
            fetch(`${backendUrl}/api/flow`)
                .then(res => res.json())
                .then(data => {
                    document.getElementById('flow-greeting').value = data.greeting || '';
                    document.getElementById('flow-branchNewUsed').value = data.branchNewUsed || '';
                    document.getElementById('flow-branchBudget').value = data.branchBudget || '';
                    document.getElementById('flow-closing').value = data.closing || '';
                }).catch(() => {});
        }

        function saveFlowTree() {
            const payload = {
                greeting: document.getElementById('flow-greeting').value,
                branchNewUsed: document.getElementById('flow-branchNewUsed').value,
                branchBudget: document.getElementById('flow-branchBudget').value,
                closing: document.getElementById('flow-closing').value
            };
            fetch(`${backendUrl}/api/flow`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(payload)
            }).then(res => res.json()).then(data => {
                if(data.success) alert("Decision tree branches saved permanently to SQLite database!");
            });
        }

        function loadLeads() {
            fetch(`${backendUrl}/api/leads`)
                .then(res => res.json())
                .then(data => {
                    const tbody = document.getElementById('crm-table-body');
                    if (data && data.length > 0) {
                        tbody.innerHTML = data.map(lead => {
                            const tier = lead.tier || 'Warm';
                            const color = tier === 'Hot' ? '#34d399' : (tier === 'Cold' ? '#f87171' : '#fbbf24');
                            return `
                            <tr>
                                <td style="color: var(--text-muted);">${lead.timestamp || ''}</td>
                                <td><strong>${lead.name}</strong></td>
                                <td style="font-family: monospace; color: #a1a1aa;">${lead.phone}</td>
                                <td>${lead.vehicle}</td>
                                <td>
                                    <select class="tier-select" onchange="updateLeadTier('${lead.phone}', this.value)" style="color: ${color};">
                                        <option value="Hot" ${tier === 'Hot' ? 'selected' : ''}>Hot Deal</option>
                                        <option value="Warm" ${tier === 'Warm' ? 'selected' : ''}>Warm</option>
                                        <option value="Cold" ${tier === 'Cold' ? 'selected' : ''}>No Deal</option>
                                    </select>
                                </td>
                            </tr>
                        `}).join('');
                    } else {
                        tbody.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">No active leads in database.</td></tr>`;
                    }
                }).catch(() => {});
        }

        function updateLeadTier(phone, newTier) {
            fetch(`${backendUrl}/api/update-lead`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ phone: phone, tier: newTier })
            });
        }

        function filterLeads(tier, element) {
            document.querySelectorAll('.filter-pill').forEach(pill => pill.classList.remove('active'));
            element.classList.add('active');
            const rows = document.querySelectorAll('#crm-table-body tr');
            rows.forEach(row => {
                if(row.children.length === 1) return;
                const selectElement = row.querySelector('.tier-select');
                if(!selectElement) return;
                if (tier === 'All' || selectElement.value === tier) row.style.display = '';
                else row.style.display = 'none';
            });
        }

        function loadLiveChats() {
            fetch(`${backendUrl}/api/contacts`)
                .then(res => res.json())
                .then(data => {
                    chatData = data.conversations || {};
                    renderChatSidebar();
                    if (activeChatPhone && chatData[activeChatPhone]) renderChatHistory(activeChatPhone);
                }).catch(() => {});
        }

        function renderChatSidebar() {
            const sidebar = document.getElementById('chat-list');
            const phones = Object.keys(chatData).sort((a, b) => new Date(chatData[b].lastUpdated) - new Date(chatData[a].lastUpdated));
            if (phones.length === 0) return;
            sidebar.innerHTML = phones.map(phone => {
                const chat = chatData[phone];
                const msgs = chat.messages || [];
                const lastMsg = msgs.length > 0 ? msgs[msgs.length - 1].content.substring(0, 30) + '...' : 'New contact';
                const isActive = activeChatPhone === phone ? 'background: var(--hover-bg); border-left: 3px solid #ffffff;' : '';
                return `
                <div class="chat-contact" style="${isActive}" onclick="selectChat('${phone}')">
                    <strong>${chat.name} (${phone})</strong><br>
                    <small style="color: var(--text-muted)">${lastMsg}</small>
                </div>
                `;
            }).join('');
        }

        function selectChat(phone) { activeChatPhone = phone; renderChatSidebar(); renderChatHistory(phone); }

        function renderChatHistory(phone) {
            const historyContainer = document.getElementById('chat-history-container');
            const chat = chatData[phone];
            if (!chat || !chat.messages || chat.messages.length === 0) {
                historyContainer.innerHTML = `<div style="text-align: center; color: var(--text-muted); margin-top: 60px;">No messages recorded yet for this contact.</div>`;
                return;
            }
            const atBottom = (historyContainer.scrollHeight - historyContainer.scrollTop) <= (historyContainer.clientHeight + 50);

            historyContainer.innerHTML = chat.messages.map(msg => {
                const isUser = msg.role === 'user';
                const senderLabel = isUser ? chat.name : (msg.sender || 'Potgieter Auto (Human)');
                return `
                <div style="display: flex; flex-direction: column; width: 100%;">
                    <small style="color: var(--text-muted); margin-bottom: 4px; ${isUser ? 'align-self: flex-start;' : 'align-self: flex-end;'}">${senderLabel}</small>
                    <div class="chat-bubble ${isUser ? 'bubble-client' : 'bubble-bot'}">${msg.content.replace(/\n/g, '<br>')}</div>
                </div>
                `;
            }).join('');
            if(atBottom) historyContainer.scrollTop = historyContainer.scrollHeight;
        }

        function sendLiveMessage() {
            if (!activeChatPhone) return alert('Select a contact first.');
            const input = document.getElementById('live-chat-input');
            const message = input.value.trim();
            if (!message) return;
            input.value = '';
            if(!chatData[activeChatPhone].messages) chatData[activeChatPhone].messages = [];
            chatData[activeChatPhone].messages.push({role: 'assistant', sender: 'Potgieter Auto (Human)', content: message});
            renderChatHistory(activeChatPhone);
            fetch(`${backendUrl}/api/send-message`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: activeChatPhone, message: message }) });
        }

        function sendTemplateToClient() {
            if (!activeChatPhone) return alert('Select a contact first.');
            const tmplName = document.getElementById('active-template-select').value;
            if (!tmplName) return alert('Select an approved template first.');
            
            const message = `[Meta Template Broadcast: ${tmplName}]`;
            if(!chatData[activeChatPhone].messages) chatData[activeChatPhone].messages = [];
            chatData[activeChatPhone].messages.push({role: 'assistant', sender: 'Potgieter Auto (Human)', content: message});
            renderChatHistory(activeChatPhone);

            fetch(`${backendUrl}/api/send-message`, { 
                method: 'POST', 
                headers: { 'Content-Type': 'application/json' }, 
                body: JSON.stringify({ phone: activeChatPhone, message: message, useTemplate: true, templateName: tmplName }) 
            }).then(() => alert(`Template "${tmplName}" dispatched to ${activeChatPhone}`));
        }

        function submitMetaTemplate() {
            const name = document.getElementById('meta-tmpl-name').value;
            const category = document.getElementById('meta-tmpl-category').value;
            const language = document.getElementById('meta-tmpl-lang').value;
            const body = document.getElementById('meta-tmpl-body').value;
            
            if(!name || !body) return alert("Template Name and Body content are required.");
            
            fetch(`${backendUrl}/api/create-template`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, category, language, body })
            }).then(res => res.json()).then(data => {
                if(data.error) alert("Meta API Error: " + data.error);
                else {
                    alert(`Template "${name}" submitted successfully to Meta Graph API for review.`);
                    if(!approvedTemplates.includes(name)) approvedTemplates.push(name);
                }
            });
        }

        function sendSandbox() {
            const input = document.getElementById('sandbox-input');
            const msg = input.value.trim();
            if(!msg) return;
            const chatBox = document.getElementById('sandbox-chat');
            if(chatBox.innerHTML.includes('Test Ava here')) chatBox.innerHTML = '';
            chatBox.innerHTML += `<div style="text-align: right; margin-bottom: 12px; color: var(--text-main);"><strong>You:</strong> ${msg}</div>`;
            input.value = '';
            fetch(`${backendUrl}/api/sandbox`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: msg }) })
            .then(res => res.json()).then(data => {
                chatBox.innerHTML += `<div style="text-align: left; margin-bottom: 12px; color: #a1a1aa;"><strong>Ava:</strong> ${data.reply}</div>`;
                chatBox.scrollTop = chatBox.scrollHeight;
            });
        }

        setInterval(() => { if (document.getElementById('page-chat').classList.contains('active')) loadLiveChats(); }, 2500);
        setTimeout(() => { loadLeads(); loadLiveChats(); loadFlowTree(); }, 1500);
    </script>
</body>
</html>
