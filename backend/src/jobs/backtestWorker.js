import { runBacktest } from '../strategies/smc-mtf/backtester.js';

process.on('message', async (options) => {
  try {
    const result = await runBacktest(options);
    process.send({ ok: true, result });
  } catch (err) {
    process.send({ ok: false, error: err.message || String(err) });
  } finally {
    process.exit(0);
  }
});
