import 'dotenv/config';
import { listAdSenseAccounts, listAccessibleAdSenseAccounts } from '../src/adsense/tools/accounts.js';
import { generateReport, listPayments, listAlerts } from '../src/adsense/tools/reports.js';

if (process.env.CI) {
  console.log('Skipping live test in CI environment.');
  process.exit(0);
}

async function runLiveAdSenseTest() {
  console.log('--- Tier 2: Live AdSense API Smoke Test Suite ---\n');

  try {
    // 1. Configured accounts
    const configured = await listAdSenseAccounts();
    console.log(`✅ Step 1: ${configured.length} configured AdSense account(s).`);
    if (configured.length === 0) {
      console.log('ℹ️ No AdSense accounts configured. Run: search-console-mcp setup --engine=adsense');
      return;
    }
    const accountId = configured[0].id;
    console.log(`ℹ Using configured account: ${accountId}`);

    // 2. Discover accessible publisher accounts
    const accessible = await listAccessibleAdSenseAccounts(accountId);
    console.log(`✅ Step 2: Discovered ${accessible.length} accessible publisher account(s).`);

    // 3. Performance report (last 7 days)
    console.log('\nStep 3: Generating LAST_7_DAYS performance report...');
    const report = await generateReport({ accountId, dateRange: 'LAST_7_DAYS' });
    console.log(`✅ adsense_report for ${report.publisherId}:`);
    console.log(`   - Headers: ${(report.headers as string[]).join(', ')}`);
    if ((report.totals as string[] | undefined)?.length) {
      console.log(`   - Totals: ${(report.totals as string[]).join(', ')}`);
    }

    // 4. Payments & alerts
    console.log('\nStep 4: Fetching payments and alerts...');
    const [payments, alerts] = await Promise.all([listPayments(accountId), listAlerts(accountId)]);
    console.log(`✅ payments: ${payments.length}, alerts: ${alerts.length}`);
    if (alerts.length > 0) {
      console.warn('⚠️ Active AdSense alerts present:');
      for (const a of alerts) {
        console.warn(`   - [${a.severity}] ${a.message}`);
      }
    }

    console.log('\n--- Live AdSense Smoke Test Completed Successfully! ---');
  } catch (error: any) {
    console.error('❌ Live test failed:', error.message);
    process.exit(1);
  }
}

runLiveAdSenseTest();
