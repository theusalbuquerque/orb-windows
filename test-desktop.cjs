const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const root = __dirname;
const read = file => fs.readFileSync(path.join(root, file), 'utf8');
const html = read('Web/index.html');
const scripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/g)];
assert.ok(scripts.length >= 2, 'Web scripts were embedded');
scripts.forEach(([, body], index) => {
  assert.doesNotThrow(() => new Function(body), 'inline script ' + index);
});
assert.doesNotThrow(() => new Function(read('Web/desktop-bridge.js')));
assert.ok(html.includes('orb-windows-paired-session'));
assert.ok(html.includes('desktop-bridge.js'));
assert.ok(!html.includes('id="open-settings"'), 'Sidebar settings button removed');
assert.ok(html.includes('function showAppTrack('), 'Live Android preview preserved');
assert.ok(html.includes("api('/listen', {method: 'POST'"), 'Browser history preserved');

const ble = read('Services/OrbBleProtocol.cs');
const native = read('Services/OrbBleTransport.cs');
const window = read('MainWindow.xaml.cs');
assert.ok(ble.includes('PayloadBytes = 18'));
assert.ok(ble.includes('ManufacturerId = 0xFFFF'));
assert.ok(ble.includes('Version = 2'));
assert.ok(ble.includes('orb-touch-account:'));
assert.ok(ble.includes('orb-touch-device:'));
assert.ok(native.includes('private string? _userId;'));
assert.ok(native.includes('This transport is not activated by the alpha player'));
assert.ok(!window.includes('_ble.StartAsync('), 'BLE handoff advertising is disabled until receiver implementation');
assert.ok(window.includes('OrbPlayer.EnsureCoreWebView2Async()'));
assert.ok(window.includes('SetVirtualHostNameToFolderMapping'));

const digest8 = value => crypto.createHash('sha256').update(value).digest().subarray(0, 8).toString('hex');
assert.equal(digest8('orb-touch-device:123e4567-e89b-12d3-a456-426614174000'), 'a47a83f79cb7fd92');
console.log('OK: Web scripts, session bootstrap, BLE protocol structure and native isolation.');
