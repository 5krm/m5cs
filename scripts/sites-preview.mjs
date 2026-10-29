import { spawn } from 'node:child_process';
// Preview the exact static output that Sites publishes. Run npm run build first.
const child = spawn('python3', ['-m', 'http.server', '4173', '--bind', '0.0.0.0', '--directory', 'out'], {stdio:'inherit'});
child.on('exit', code => process.exit(code ?? 1));
