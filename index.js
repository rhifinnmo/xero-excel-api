require('dotenv').config();
const express = require('express');
const { XeroClient } = require('xero-node');
const cors = require('cors');

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

app.get('/', async (req, res) => {
  const consentUrl = await xero.buildConsentUrl();
  res.send(`<a href="${consentUrl}">Connect to Xero</a>`);
});

app.get('/callback', async (req, res) => {
  await xero.apiCallback(req.url);
  await xero.updateTenants();
  tenantId = xero.tenants[0].tenantId;
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

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
});