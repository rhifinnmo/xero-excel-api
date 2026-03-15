require('dotenv').config();
const express = require('express');
const { XeroClient } = require('xero-node');
const cors = require('cors');
const fs = require('fs');

const app = express();
app.use(cors());
const xero = new XeroClient({
  clientId: process.env.XERO_CLIENT_ID,
  clientSecret: process.env.XERO_CLIENT_SECRET,
  redirectUris: [process.env.REDIRECT_URI],
  scopes: [
    'openid', 'profile', 'email', 'offline_access',
    'accounting.invoices.read',
    'accounting.contacts.read',
    'accounting.settings.read',
    'accounting.reports.aged.read',
    'accounting.reports.trialbalance.read',
    'accounting.reports.banksummary.read'
  ]
});

let tenantId = null;

// Load saved tokens on startup
const saved = loadTokens();
if (saved) {
  xero.setTokenSet(saved.tokenSet);
  tenantId = saved.tenantId;
}

const TOKEN_PATH = './tokens.json';

function saveTokens(tokenSet, tenantId) {
  fs.writeFileSync(TOKEN_PATH, JSON.stringify({ tokenSet, tenantId }));
}

function loadTokens() {
  try {
    if (fs.existsSync(TOKEN_PATH)) {
      return JSON.parse(fs.readFileSync(TOKEN_PATH));
    }
  } catch (e) {}
  return null;
}

app.get('/', async (req, res) => {
  const consentUrl = await xero.buildConsentUrl();
  res.send(`<a href="${consentUrl}">Connect to Xero</a>`);
});

app.get('/callback', async (req, res) => {
  const tokenSet = await xero.apiCallback(req.url);
  await xero.updateTenants();
  tenantId = xero.tenants[0].tenantId;
  saveTokens(tokenSet, tenantId);
  res.send('Successfully connected to Xero!');
});

// Invoices - loop through all pages
app.get('/invoices', async (req, res) => {
  let page = 1;
  let allInvoices = [];
  while (true) {
    const response = await xero.accountingApi.getInvoices(
      tenantId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      ['AUTHORISED'],
      page,
      true,
      true,
      undefined,
      true
    );
    const invoices = response.body.invoices;
    if (!invoices || invoices.length === 0) break;
    allInvoices = allInvoices.concat(invoices);
    page++;
  }
  res.json(allInvoices);
});

// Chart of Accounts
app.get('/accounts', async (req, res) => {
  const response = await xero.accountingApi.getAccounts(tenantId);
  res.json(response.body.accounts);
});

// Trial Balance
app.get('/reports/trialbalance', async (req, res) => {
  const response = await xero.accountingApi.getReportTrialBalance(tenantId);
  res.json(response.body.reports);
});

// Rolling Trial Balance
app.get('/reports/rollingtrialbalance', async (req, res) => {
  const results = [];
  const now = new Date();
  let date = new Date(2000, 0, 31);

  while (date <= now) {
    const dateStr = date.toISOString().split('T')[0];
    try {
      const response = await xero.accountingApi.getReportTrialBalance(tenantId, dateStr);
      const report = response.body.reports[0];
      if (report && report.rows) {
        report.rows.forEach(section => {
          if (section.rows) {
            section.rows.forEach(row => {
              if (row.cells && row.cells.length > 0) {
                results.push({
                  month: dateStr,
                  account: row.cells[0]?.value || '',
                  debit: row.cells[1]?.value || '',
                  credit: row.cells[2]?.value || '',
                  ytdDebit: row.cells[3]?.value || '',
                  ytdCredit: row.cells[4]?.value || ''
                });
              }
            });
          }
        });
      }
    } catch (e) {
      // Skip months with no data
    }

    // Move to next month end
    date = new Date(date.getFullYear(), date.getMonth() + 2, 0);
  }

  res.json(results);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});