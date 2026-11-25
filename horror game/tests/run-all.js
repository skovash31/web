// Runs every automated test: level validation, CEO AI behaviour, and the full
// two-player online playthrough against a real server instance.
import { validateLevels } from './validate-levels.js';
import { runCeoTests } from './ceo-ai.js';
import { runPlaythrough } from './playthrough.js';
import { runFeatureTests, runOnlineFeatureTests } from './features.js';
import { runStaplerTests, runOnlineStaplerTests } from './stapler.js';
import { runItemTests, runOnlineItemTests } from './items.js';

console.log('Level validation');
const lv = validateLevels(true);
console.log(lv ? `  ${lv} failures` : '  ✓ all 6 floors valid');
const ceo = runCeoTests();
console.log('');
runFeatureTests();
const feat = await runOnlineFeatureTests();
console.log('');
runStaplerTests();
const stap = await runOnlineStaplerTests();
console.log('');
runItemTests();
const items = await runOnlineItemTests();
console.log('\nMultiplayer playthrough');
const pt = await runPlaythrough();
const failed = lv + ceo.failed + feat.failed + stap.failed + items.failed + pt.failed;
console.log(`\nSUMMARY: levels ${lv ? 'FAIL' : 'ok'} · CEO AI ${ceo.passed}/${ceo.passed + ceo.failed} · features ${feat.passed}/${feat.passed + feat.failed} · stapler ${stap.passed}/${stap.passed + stap.failed} · items ${items.passed}/${items.passed + items.failed} · playthrough ${pt.passed}/${pt.passed + pt.failed}`);
process.exit(failed ? 1 : 0);
