// Never answers, and records its pid so the test can check it was killed.
import { writeFileSync } from 'node:fs';

writeFileSync(process.argv[2], String(process.pid));
setInterval(() => {}, 1000);
