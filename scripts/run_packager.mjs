import { spawnSync } from 'node:child_process';

const script = 'scripts/package_release.py';
const candidates = process.platform === 'win32'
  ? [['py', '-3', script], ['python', script], ['python3', script]]
  : [['python3', script], ['python', script]];

for (const [command, ...args] of candidates) {
  const result = spawnSync(command, args, { stdio: 'inherit', windowsHide: true });
  if (result.error?.code === 'ENOENT') continue;
  process.exit(result.status ?? 1);
}

console.error('未找到 Python 3；请安装后重新运行 npm run package。');
process.exit(1);
