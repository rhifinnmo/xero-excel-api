const API_BASE = 'https://xero-excel-api-production.up.railway.app';

Office.onReady(async () => {
  await loadOrganisations();
  document.getElementById('btn-switch').onclick = switchOrganisation;
  document.getElementById('btn-invoices').onclick = () => loadData('/invoices', 'Invoices');
  document.getElementById('btn-accounts').onclick = () => loadData('/accounts', 'Accounts');
  document.getElementById('btn-trialbalance').onclick = () => loadData('/reports/trialbalance', 'Trial Balance');
  document.getElementById('btn-rollingtrialbalance').onclick = () => loadRollingTrialBalance();
  document.getElementById('btn-connect').onclick = connectNewOrganisation;
});

async function loadOrganisations() {
  try {
    const response = await fetch(API_BASE + '/organisations');
    const orgs = await response.json();
    const select = document.getElementById('org-select');
    select.innerHTML = '';
    orgs.forEach(org => {
      const option = document.createElement('option');
      option.value = org.tenantId;
      option.textContent = org.name;
      select.appendChild(option);
    });
    document.getElementById('current-org').textContent = `Current: ${orgs[0]?.name || 'Unknown'}`;
  } catch (err) {
    document.getElementById('current-org').textContent = 'Error loading organisations';
  }
}

async function switchOrganisation() {
  const select = document.getElementById('org-select');
  const tenantId = select.value;
  const orgName = select.options[select.selectedIndex].text;
  const status = document.getElementById('status');
  status.textContent = `Switching to ${orgName}...`;
  try {
    const response = await fetch(`${API_BASE}/switch/${tenantId}`);
    const data = await response.json();
    if (data.success) {
      document.getElementById('current-org').textContent = `Current: ${orgName}`;
      status.textContent = `Switched to ${orgName} successfully!`;
    }
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function loadData(endpoint, sheetName) {
  const status = document.getElementById('status');
  status.textContent = `Loading ${sheetName}...`;
  try {
    const response = await fetch(API_BASE + endpoint);
    const data = await response.json();
    await Excel.run(async (context) => {
      const sheets = context.workbook.worksheets;
      sheets.load('items/name');
      await context.sync();
      const existing = sheets.items.find(s => s.name === sheetName);
      if (existing) existing.delete();
      const sheet = sheets.add(sheetName);
      sheet.activate();
      const rows = flattenData(data);
      if (rows.length > 0) {
        const range = sheet.getRangeByIndexes(0, 0, rows.length, rows[0].length);
        range.values = rows;
      }
      await context.sync();
      status.textContent = `${sheetName} loaded successfully!`;
    });
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

async function loadRollingTrialBalance() {
  const status = document.getElementById('status');
  status.textContent = 'Loading Rolling Trial Balance... this may take a minute!';
  try {
    const response = await fetch(API_BASE + '/reports/rollingtrialbalance');
    const data = await response.json();
    await Excel.run(async (context) => {
      const sheets = context.workbook.worksheets;
      sheets.load('items/name');
      await context.sync();
      const existing = sheets.items.find(s => s.name === 'Rolling Trial Balance');
      if (existing) existing.delete();
      const sheet = sheets.add('Rolling Trial Balance');
      sheet.activate();
      const headers = ['Month', 'Account', 'Debit', 'Credit', 'YTD Debit', 'YTD Credit'];
      const rows = [headers];
      data.forEach(row => {
        rows.push([row.month, row.account, row.debit, row.credit, row.ytdDebit, row.ytdCredit]);
      });
      const range = sheet.getRangeByIndexes(0, 0, rows.length, headers.length);
      range.values = rows;
      await context.sync();
      status.textContent = 'Rolling Trial Balance loaded successfully!';
    });
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}

function flattenData(data) {
  if (!data || data.length === 0) return [];
  if (data[0] && data[0].rows) {
    const rows = [['Account', 'Debit', 'Credit', 'YTD Debit', 'YTD Credit']];
    data[0].rows.forEach(section => {
      if (section.rows) {
        section.rows.forEach(row => {
          if (row.cells) {
            rows.push(row.cells.map(c => c.value || ''));
          }
        });
      }
    });
    return rows;
  }
  const headers = Object.keys(data[0]).filter(k => typeof data[0][k] !== 'object');
  const rows = [headers];
  data.forEach(item => {
    rows.push(headers.map(h => item[h] !== null && item[h] !== undefined ? String(item[h]) : ''));
  });
  return rows;
}

async function connectNewOrganisation() {
  const status = document.getElementById('status');
  status.textContent = 'Opening Xero login...';
  try {
    const response = await fetch(API_BASE + '/connect');
    const data = await response.json();
    window.open(data.url, '_blank');
    status.textContent = 'Complete the login in your browser, then click Switch Organisation to refresh.';
  } catch (err) {
    status.textContent = `Error: ${err.message}`;
  }
}