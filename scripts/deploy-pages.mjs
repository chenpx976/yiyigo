import { execFileSync, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// Publish the checked build in an isolated temporary checkout. Never force-push
// or switch the source checkout; an existing deployment history stays intact.
const root = fileURLToPath(new URL('../', import.meta.url));
const git = (args, cwd = root) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
if (git(['status', '--porcelain'])) throw new Error('Commit the source changes before publishing.');
if (git(['branch', '--show-current']) !== 'main') throw new Error('Publish from main.');
const sourceCommit = git(['rev-parse', 'HEAD']);
const attribution = git(['log', '-1', '--format=%(trailers:key=Co-Authored-By)']);
const remote = git(['remote', 'get-url', 'origin']);
const repository = remote.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
if (!repository) throw new Error('origin must point to the intended GitHub repository.');
if (git(['ls-remote', 'origin', 'refs/heads/main']).split(/\s+/)[0] !== sourceCommit)
  throw new Error('Push main before publishing its build.');
const dist = resolve(root, 'dist');
if (!existsSync(join(dist, 'index.html'))) throw new Error('Run npm run check to build dist first.');
const identity = { name: git(['config', 'user.name']), email: git(['config', 'user.email']) };
const checkout = mkdtempSync(join(tmpdir(), 'yiyigo-pages-'));
try {
  git(['init', '--initial-branch=gh-pages'], checkout);
  git(['remote', 'add', 'origin', remote], checkout);
  const branch = spawnSync('git', ['ls-remote', '--exit-code', '--heads', 'origin', 'gh-pages'], { cwd: checkout, encoding: 'utf8' });
  if (branch.status === 0) {
    git(['fetch', '--depth=1', 'origin', 'gh-pages'], checkout);
    git(['reset', '--hard', 'FETCH_HEAD'], checkout);
  } else if (branch.status !== 2) {
    throw new Error(`Cannot inspect deployment branch: ${branch.stderr}`);
  }
  for (const item of readdirSync(checkout))
    if (item !== '.git') rmSync(join(checkout, item), { recursive: true, force: true });
  cpSync(dist, checkout, { recursive: true });
  writeFileSync(join(checkout, '.nojekyll'), '');
  writeFileSync(join(checkout, 'build-info.json'), JSON.stringify({ sourceCommit }, null, 2) + '\n');
  git(['add', '--all'], checkout);
  const changed = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: checkout });
  if (changed.status === 1) {
    const message = `Deploy ${sourceCommit.slice(0, 7)}${attribution ? `\n\n${attribution}` : ''}`;
    git(['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`, 'commit', '-m', message], checkout);
    git(['push', 'origin', 'HEAD:gh-pages'], checkout);
  } else if (changed.status !== 0) throw new Error('Cannot inspect staged deployment.');
  console.log(`Published build for ${sourceCommit}`);
  console.log(`https://${repository[1]}.github.io/${repository[2]}/`);
} finally {
  rmSync(checkout, { recursive: true, force: true });
}
