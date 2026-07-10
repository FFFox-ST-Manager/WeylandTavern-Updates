#!/usr/bin/env node
'use strict';

/*
 * Weyland Tavern Launcher - V6.0 (Node port of the V5 batch script)
 * by Kressa, Lucky Paw, Shiru & FFFox
 *
 * Why Node instead of batch:
 *  - cmd reads .bat files by byte offset WHILE they run, so the old script
 *    had to copy itself to %TEMP% and relaunch before git pull could
 *    replace it. That self-copy pattern is a classic AV heuristic trigger
 *    (Gen:Heur.Bat.*). Node loads this whole file into memory at startup,
 *    so git can freely replace it on disk mid-run - no relaunch trick needed.
 *  - Node writes to the Windows console via WriteConsoleW, so the Unicode
 *    header renders correctly on CJK codepages too - no chcp detection or
 *    plain-ASCII fallback required.
 *
 * Requires Node 18+. Zero dependencies - runs before npm install.
 * Kept self-contained on purpose: it must work even if every other file
 * in the repo is broken (that's what the repair tool is for).
 */

const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const net = require('net');
const path = require('path');
const readline = require('readline');

// Anchor everything to the folder this script lives in, never the process
// CWD (launched "as administrator", Windows defaults CWD to System32).
process.chdir(__dirname);

const tty = process.stdout.isTTY;
const esc = (code) => (tty ? `\x1b[${code}m` : '');

// Weyland palette (matches the Weyland-Router extension theme)
const R = esc('0');
const WINE = esc('38;2;180;38;58');
const PINK = esc('38;2;224;68;92');
const ROSE = esc('38;2;255;150;165');
const DIM = esc('38;2;125;125;125');
const GRY = esc('38;2;190;190;190');
const GRN = esc('38;2;97;191;124');
const AMB = esc('38;2;230;180;80');
const BLD = esc('1');

const log = console.log;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

function ask(question, def) {
  return new Promise((resolve) => {
    let settled = false;
    rl.question(question, (answer) => {
      settled = true;
      resolve((answer || '').trim() || def);
    });
    // stdin closing (piped input ran dry) should not hang the script
    rl.once('close', () => { if (!settled) resolve(def); });
  });
}

async function yesNo(prompt, def) {
  const answer = await ask(`  ${PINK}›${R} ${prompt} (Y/N) [Default: ${def}] `, def);
  return answer.toUpperCase() === 'Y';
}

async function waitEnter(msg) {
  await ask(`  ${DIM}${msg || 'Press Enter to close...'}${R}`, '');
}

// --- child-process helpers -------------------------------------------------

function git(...args) {
  const r = spawnSync('git', args, { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim();
}

function findPidOnPort(port) {
  if (process.platform === 'win32') {
    const r = spawnSync('netstat', ['-ano'], { encoding: 'utf8' });
    if (r.error || r.status !== 0) return null;
    for (const line of r.stdout.split('\n')) {
      if (line.includes('LISTENING') && new RegExp(`:${port}\\s`).test(line)) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (/^\d+$/.test(pid)) return pid;
      }
    }
    return null;
  }
  const r = spawnSync('lsof', ['-ti', `:${port}`], { encoding: 'utf8' });
  if (r.error || r.status !== 0) return null;
  return r.stdout.trim().split('\n')[0] || null;
}

function killPid(pid) {
  if (process.platform === 'win32') {
    spawnSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'ignore' });
  } else {
    try { process.kill(Number(pid), 'SIGKILL'); } catch {}
  }
}

function portListening(port) {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: '127.0.0.1', port, timeout: 1000 });
    socket.once('connect', () => { socket.destroy(); resolve(true); });
    socket.once('error', () => resolve(false));
    socket.once('timeout', () => { socket.destroy(); resolve(false); });
  });
}

// --- header ------------------------------------------------------------------

const BOX_INNER = 57; // interior width of the framed boxes

function stripAnsi(s) {
  return s.replace(/\x1b\[[0-9;]*m/g, '');
}

function boxLine(text) {
  const pad = ' '.repeat(Math.max(0, BOX_INNER - stripAnsi(text).length));
  return `  ${WINE}│${R} ${text}${pad}${WINE}│${R}`;
}

function boxTop() { return `  ${WINE}┌${'─'.repeat(BOX_INNER + 1)}┐${R}`; }
function boxBottom() { return `  ${WINE}└${'─'.repeat(BOX_INNER + 1)}┘${R}`; }

function printHeader() {
  if (tty) process.stdout.write('\x1b]0;Weyland Tavern\x07'); // console title
  if (tty) process.stdout.write('\x1b[2J\x1b[H'); // cls
  log('');
  log(`  ${WINE}██╗    ██╗███████╗██╗   ██╗██╗      █████╗ ███╗   ██╗██████╗${R}`);
  log(`  ${WINE}██║    ██║██╔════╝╚██╗ ██╔╝██║     ██╔══██╗████╗  ██║██╔══██╗${R}`);
  log(`  ${PINK}██║ █╗ ██║█████╗   ╚████╔╝ ██║     ███████║██╔██╗ ██║██║  ██║${R}`);
  log(`  ${PINK}██║███╗██║██╔══╝    ╚██╔╝  ██║     ██╔══██║██║╚██╗██║██║  ██║${R}`);
  log(`  ${ROSE}╚███╔███╔╝███████╗   ██║   ███████╗██║  ██║██║ ╚████║██████╔╝${R}`);
  log(`  ${ROSE} ╚══╝╚══╝ ╚══════╝   ╚═╝   ╚══════╝╚═╝  ╚═╝╚═╝  ╚═══╝╚═════╝${R}`);
  log('');
  const dash = '─'.repeat(22);
  log(`  ${DIM}${dash}${R}  ${BLD}${PINK}T A V E R N${R}  ${DIM}${dash}${R}`);
  log(`            ${DIM}V6.0 - by Kressa, Lucky Paw, Shiru & FFFox${R}`);
  log('');
  log(boxTop());
  log(boxLine(` ${AMB}●${R}  ${GRY}Keep this window open while using Weyland Tavern.${R}`));
  log(boxLine(`    ${DIM}Closing it will shut down the server.${R}`));
  log(boxBottom());
  log('');
}

function printDivider() {
  log('');
  log(`  ${DIM}${'─'.repeat(61)}${R}`);
  log('');
}

// --- git update check ---------------------------------------------------------

async function gitUpdateCheck() {
  if (spawnSync('git', ['--version'], { stdio: 'ignore' }).error) {
    log(`  ${AMB}!${R}  ${GRY}Git is not installed - cannot check for updates.${R}`);
    log(`     ${DIM}Please install git manually to receive the latest updates.${R}`);
    if (!(await yesNo('Continue without update checking?', 'Y'))) process.exit(0);
    return;
  }

  const branch = git('rev-parse', '--abbrev-ref', 'HEAD') || '';
  const currentVersion = git('rev-parse', '--short', 'HEAD') || 'unknown';

  log(`  ${DIM}*${R}  ${GRY}Checking for Weyland Tavern updates...${R}`);
  log('');

  git('fetch');
  const newVersion = (branch && git('rev-parse', '--short', `origin/${branch}`)) || 'unknown';

  if (currentVersion === newVersion) {
    log(`  ${GRN}+${R}  ${GRY}Weyland Tavern is up to date.${R}  ${DIM}(version ${currentVersion})${R}`);
    return;
  }

  log(`  ${PINK}*${R}  ${BLD}${GRY}Update found.${R}`);
  log(`     ${DIM}Current version:${R} ${GRY}${currentVersion}${R}`);
  log(`     ${DIM}New version:    ${R} ${PINK}${newVersion}${R}`);
  log('');
  if (!(await yesNo('Apply update?', 'Y'))) {
    log(`  ${DIM}*${R}  ${GRY}Proceeding without update...${R}`);
    return;
  }

  log('');
  log(`  ${DIM}*${R}  ${GRY}Applying update...${R}`);
  // git pull may replace this very file on disk - harmless, Node already
  // loaded it into memory. The old batch launcher needed a %TEMP% relaunch
  // trick for this; that's the pattern AV heuristics kept flagging.
  const pull = spawnSync('git', ['pull'], { encoding: 'utf8' });
  try {
    fs.writeFileSync(path.join(__dirname, 'SillyTavern', 'WTUpdate.log'), (pull.stdout || '') + (pull.stderr || ''));
  } catch {}
  if (!pull.error && pull.status === 0) {
    log(`  ${GRN}+${R}  ${GRN}Update applied successfully.${R}`);
    return;
  }

  log('');
  log(`  ${AMB}!${R}  ${AMB}Update failed - there may be file conflicts.${R}`);
  log(`     ${DIM}Generating log file: SillyTavern${path.sep}WTUpdate.log${R}`);
  log('');
  spawnSync('git', ['--no-pager', 'diff', '--compact-summary'], { stdio: 'inherit' });
  log('');
  if (await yesNo("Reset to latest official version? Your personal files won't be affected.", 'Y')) {
    log('');
    log(`  ${DIM}*${R}  ${GRY}Resetting to latest version...${R}`);
    git('merge', '--abort');
    const conflicted = git('diff', '--name-only', '--diff-filter=U');
    if (conflicted) {
      for (const file of conflicted.split('\n').filter(Boolean)) {
        git('checkout', '--theirs', file);
        git('add', file);
      }
    }
    if (git('reset', '--hard', `origin/${branch}`) !== null) {
      log(`  ${GRN}+${R}  ${GRN}Update applied successfully.${R}`);
      return;
    }
    log(`  ${WINE}x${R}  ${WINE}Reset failed. Please contact support.${R}`);
    log(`     ${DIM}Log saved to: SillyTavern${path.sep}WTUpdate.log${R}`);
  }
  if (!(await yesNo('Continue without update?', 'N'))) process.exit(0);
}

// --- main --------------------------------------------------------------------

async function main() {
  printHeader();
  await gitUpdateCheck();
  printDivider();

  // Keep the CORS proxy enabled in SillyTavern's config (same patch the
  // old launcher applied through an inline PowerShell block).
  const configPath = path.join(__dirname, 'SillyTavern', 'config.yaml');
  try {
    if (fs.existsSync(configPath)) {
      let config = fs.readFileSync(configPath, 'utf8');
      if (/^[ \t]*enableCorsProxy:[^\r\n]*/m.test(config)) {
        config = config.replace(/^[ \t]*enableCorsProxy:[^\r\n]*/m, 'enableCorsProxy: true');
      } else {
        config = config.trimEnd() + '\nenableCorsProxy: true\n';
      }
      fs.writeFileSync(configPath, config);
    }
  } catch {}

  if (!fs.existsSync(path.join(__dirname, 'SillyTavern', 'server.js'))) {
    log(`  ${WINE}x${R}  ${WINE}SillyTavern${path.sep}server.js was not found next to this launcher.${R}`);
    log(`     ${DIM}Make sure the launcher sits in your WeylandTavern folder.${R}`);
    await waitEnter();
    rl.close();
    process.exit(1);
  }

  log(`  ${DIM}*${R}  ${GRY}Preparing dependencies...${R} ${DIM}(first run can take a few minutes)${R}`);
  const npmResult = spawnSync('npm install --no-audit --no-fund --loglevel=error --no-progress --omit=dev', {
    cwd: path.join(__dirname, 'SillyTavern'),
    shell: true,
    stdio: 'ignore',
    env: { ...process.env, NODE_ENV: 'production' },
  });
  if (npmResult.error || npmResult.status !== 0) {
    log(`  ${AMB}!${R}  ${GRY}Dependency install reported a problem - starting anyway...${R}`);
  }

  log('');
  log(`  ${DIM}*${R}  ${GRY}Starting the Weyland Tavern server...${R}`);
  log('');

  // Close any stale server still holding port 8000 (e.g. orphaned from a previous session)
  const stalePid = findPidOnPort(8000);
  if (stalePid) {
    killPid(stalePid);
    await sleep(2000);
  }

  // Start the SillyTavern server (extra launcher args pass through)
  const server = spawn(
    process.execPath,
    ['server.js', '--listen', 'true', '--listen-host', '0.0.0.0', '--listen-port', '8000', ...process.argv.slice(2)],
    {
      cwd: path.join(__dirname, 'SillyTavern'),
      stdio: 'ignore',
      env: { ...process.env, NODE_ENV: 'production' },
    }
  );

  // Wait until the server is actually listening before declaring it active.
  // On the very first launch, SillyTavern downloads extra components
  // (image captioning model and such) BEFORE it starts listening, which
  // can take several minutes.
  log(`  ${DIM}*${R}  ${GRY}Waiting for the server to come online...${R}`);
  log(`     ${DIM}First launch can take several minutes while extra${R}`);
  log(`     ${DIM}components download - this is normal. Hang tight~${R}`);
  log('');

  let up = false;
  for (let tick = 0; tick < 300 && !up; tick++) {
    up = await portListening(8000);
    if (!up) await sleep(2000);
  }

  if (up) {
    log(boxTop());
    log(boxLine(''));
    log(boxLine(`     ${GRN}●${R}  ${BLD}${GRY}WEYLAND TAVERN IS NOW ACTIVE${R}`));
    log(boxLine(`        ${DIM}Server running on${R} ${PINK}localhost:8000${R}`));
    log(boxLine(''));
    log(boxBottom());
    log('');
    log(`     ${DIM}A browser window should open automatically.${R}`);
    log('');
    log(`  ${AMB}!${R}  ${GRY}Reminder: keep this window open!${R}`);
    log('');
  } else {
    log(`  ${AMB}!${R}  ${GRY}The server is taking unusually long to start (10+ minutes).${R}`);
    log(`     ${DIM}It may still be downloading, or something went wrong.${R}`);
    log(`     ${DIM}If this keeps happening, please contact support.${R}`);
    log('');
  }

  await waitEnter('Press Enter to shut down and close Weyland Tavern...');

  log('');
  log(`  ${DIM}*${R}  ${GRY}Shutting down the Weyland Tavern server... see you soon~${R}`);
  killPid(server.pid);
  const leftover = findPidOnPort(8000);
  if (leftover) killPid(leftover);
  rl.close();
  process.exit(0);
}

main().catch(async (err) => {
  log('');
  log(`  ${WINE}x${R}  ${WINE}The launcher hit an unexpected error:${R}`);
  log(`     ${DIM}${err.message}${R}`);
  log('');
  await waitEnter();
  rl.close();
  process.exit(1);
});
