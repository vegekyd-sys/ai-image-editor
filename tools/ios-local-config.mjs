#!/usr/bin/env node
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const configPath = path.join(projectRoot, 'ios', 'App', 'App', 'capacitor.config.json');
const prodAllowNavigation = ['www.makaron.app', 'makaron.app', 'cdn.makaron.app'];

function detectLanIp() {
  for (const interfaces of Object.values(os.networkInterfaces())) {
    for (const iface of interfaces ?? []) {
      if (iface.family !== 'IPv4' || iface.internal) continue;
      if (iface.address.startsWith('169.254.')) continue;
      return iface.address;
    }
  }
  return '127.0.0.1';
}

function usage() {
  console.log(`Usage:
  npm run ios:local
  npm run ios:local -- --url http://192.168.1.10:3001
  npm run ios:prod

The local command patches ios/App/App/capacitor.config.json for Xcode Debug runs.
Release/source config remains capacitor.config.ts.`);
}

const args = process.argv.slice(2);
if (args.includes('--help') || args.includes('-h')) {
  usage();
  process.exit(0);
}

if (!fs.existsSync(configPath)) {
  console.error(`Missing ${configPath}. Run npx cap sync ios first.`);
  process.exit(1);
}

const config = JSON.parse(fs.readFileSync(configPath, 'utf8'));
config.server = config.server ?? {};

if (args.includes('--reset')) {
  delete config.server.url;
  delete config.server.cleartext;
  config.server.errorPath = 'index.html';
  config.server.allowNavigation = prodAllowNavigation;
  fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  console.log('iOS Capacitor config reset to production web origin.');
  process.exit(0);
}

const urlArgIndex = args.indexOf('--url');
const url = process.env.IOS_DEV_SERVER_URL
  || (urlArgIndex >= 0 ? args[urlArgIndex + 1] : undefined)
  || `http://${detectLanIp()}:3001`;

let parsed;
try {
  parsed = new URL(url);
} catch {
  console.error(`Invalid URL: ${url}`);
  process.exit(1);
}

config.server.url = parsed.toString().replace(/\/$/, '');
config.server.cleartext = parsed.protocol === 'http:';
// Local acceptance must fail locally instead of silently loading the bundled
// production fallback. A brief Next.js Fast Refresh or LAN interruption can
// otherwise send the WebView to www.makaron.app and hide unshipped changes.
delete config.server.errorPath;
config.server.allowNavigation = Array.from(new Set([
  ...prodAllowNavigation,
  parsed.hostname,
]));

fs.writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);

console.log(`iOS Debug WebView will load: ${config.server.url}`);
console.log('For stable phone acceptance, run: npm run build && npm run start:ios');
console.log('For active development with Fast Refresh, run: npm run dev:ios');
console.log('Then open ios/App/App.xcworkspace in Xcode and Run on your iPhone.');
