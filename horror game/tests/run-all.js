// Runs every automated test: level validation, CEO AI behaviour, and the full
// two-player online playthrough against a real server instance.
import { validateLevels } from './validate-levels.js';
import { runCeoTests } from './ceo-ai.js';
import { runPlaythrough } from './playthrough.js';

console.log('Level validation');
const lv = validateLevels(true);
console.log(lv ? `  ${lv} failures` : '  ✓ all 6 floors valid');
const ceo = runCeoTests();
console.log('\nMultiplayer playthrough');
const pt = await runPlaythrough();
const failed = lv + ceo.failed + pt.failed;
console.log(`\nSUMMARY: levels ${lv ? 'FAIL' : 'ok'} · CEO AI ${ceo.passed}/${ceo.passed + ceo.failed} · playthrough ${pt.passed}/${pt.passed + pt.failed}`);
process.exit(failed ? 1 : 0);
