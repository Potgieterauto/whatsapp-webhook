// --- SAVE OR UPDATE ROW PER CLIENT (HOVER NOTES VERSION) ---
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
    
    const sheet = doc.sheetsByIndex[0]; 
    const rows = await sheet.getRows();
    
    // Format conversation history neatly into a single text block for the hover note
    const formattedChatLog = rawHistory
      .filter(msg => msg && msg.content)
      .map(msg => `${msg.role === 'assistant' ? 'Ava' : 'Client'}: ${msg.content}`)
      .join('\n');

    // Find the client row by matching the Phone number string
    const existingRow = rows.find(row => String(row.toObject()['Phone']) === String(phone));
    const timestamp = new Date().toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg' });

    // Fallback tier tracking if deep Gemini JSON extraction hasn't triggered yet
    let fallbackTier = "Warm";
    if (rawHistory.length <= 2) fallbackTier = "Cold"; 
    if (formattedChatLog.toLowerCase().includes("consultant")) fallbackTier = "Hot"; 

    if (existingRow) {
      console.log(`SHEETS: Updating row for client ${phone}`);
      
      const updateData = {
        'Date': timestamp,
        'Chat History': 'Hover to view chat' // Keep cell text clean and minimal
      };

      if (extractedData) {
        if (extractedData.name && extractedData.name !== "Unknown") updateData['Name'] = extractedData.name;
        if (extractedData.vehicle && extractedData.vehicle !== "Unknown") updateData['Vehicle'] = extractedData.vehicle;
        if (extractedData.condition && extractedData.condition !== "Unknown") updateData['Condition'] = extractedData.condition;
        if (extractedData.budget && extractedData.budget !== "Unknown") updateData['Budget'] = extractedData.budget;
        if (extractedData.tier && extractedData.tier !== "Cold") updateData['Tier'] = extractedData.tier;
      } else {
        if (name && (!existingRow.toObject()['Name'] || existingRow.toObject()['Name'] === 'Unknown')) {
          updateData['Name'] = name;
        }
        updateData['Tier'] = fallbackTier;
      }

      existingRow.assign(updateData);
      await existingRow.save();

      // Attach the chat log as a hover note to column H (index 7)
      const rowIndex = existingRow.rowNumber - 1; // Convert to 0-based index
      await sheet._makeRequest({
        updateCells: {
          rows: [{
            values: [
              { note: formattedChatLog }
            ]
          }],
          fields: 'note',
          start: { sheetId: sheet.sheetId, rowIndex: rowIndex, columnIndex: 7 } // Column H is index 7
        }
      });

      console.log("SHEETS SUCCESS: Existing row and hover note updated!");

    } else {
      console.log(`SHEETS: Creating brand new unique row for client ${phone}`);
      
      const newRow = await sheet.addRow({
        'Date': timestamp,
        'Name': extractedData?.name || name,
        'Phone': phone,
        'Vehicle': extractedData?.vehicle || 'Unknown',
        'Condition': extractedData?.condition || 'Unknown',
        'Budget': extractedData?.budget || 'Unknown',
        'Tier': extractedData?.tier || fallbackTier,
        'Chat History': 'Hover to view chat'
      });

      // Attach the hover note to the newly created row
      const rowIndex = newRow.rowNumber - 1;
      await sheet._makeRequest({
        updateCells: {
          rows: [{
            values: [
              { note: formattedChatLog }
            ]
          }],
          fields: 'note',
          start: { sheetId: sheet.sheetId, rowIndex: rowIndex, columnIndex: 7 }
        }
      });

      console.log("SHEETS SUCCESS: New client row and hover note added!");
    }
  } catch (error) {
    console.error("SHEETS ERROR: Failed to balance row updates:", error);
  }

