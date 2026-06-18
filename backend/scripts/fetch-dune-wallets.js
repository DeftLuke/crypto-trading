#!/usr/bin/env node
/**
 * Fetch Dune queries and build all-wallets registry.
 * Usage: DUNE_API_KEY=... node scripts/fetch-dune-wallets.js
 */
import { fetchStoreAndImportDune } from '../src/services/walletScanner/index.js';

const queryIds = {
  tronWallets: 4003316,
  tronTradesRecent: 4009866,
  tronTrades: 4003641,
  baseDailyStats: 5797617,
};

const report = await fetchStoreAndImportDune(queryIds);
console.log(JSON.stringify(report, null, 2));
