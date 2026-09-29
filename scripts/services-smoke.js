import { writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import assert from 'node:assert/strict';
import { fixture } from './smoke-helpers.js';
const lab = await fixture('services', 3);
const [port, dbPort, mailPort] = lab.ports;
const recipe = `version: 1
port: ${port}
cron: system
services:
  databaseAdmin: {port: ${dbPort}}
  mail: {port: ${mailPort}}
  redis: true
`;
try {
  await writeFile(lab.configFile, recipe);
  lab.cli('up');
  assert.match(lab.cli('tools'), new RegExp(`:${mailPort}`));
  assert.match(await (await fetch(`http://localhost:${dbPort}`)).text(), /Adminer/);
  assert.match(lab.wp('redis', 'status'), /Connected/);
  assert.equal(lab.wp('eval', 'echo (int) wp_using_ext_object_cache();'), '1');
  lab.wp('eval', 'wp_cache_set("smoke-persistent", "cached-value", "lab", 300);');
  assert.equal(lab.wp('eval', 'echo wp_cache_get("smoke-persistent", "lab");'), 'cached-value');
  lab.wp('eval', 'add_action("wp_mail_failed", function ($error) { WP_CLI::error($error->get_error_message()); }); if (!wp_mail("tester@example.test", "Lab capture test", "No external delivery")) { WP_CLI::error("Mail was not accepted"); }');
  const inbox = await (await fetch(`http://localhost:${mailPort}/api/v1/messages`)).json();
  assert.ok(inbox.messages.some(message => message.Subject === 'Lab capture test'));
  // A fresh mu-plugin gives the cron worker a real observable job.
  const hook = '<?php add_action("lab_cron_probe", function () { update_option("lab_cron_ran", "yes"); });';
  lab.wp('eval', `if (file_put_contents(WPMU_PLUGIN_DIR . '/lab-cron-probe.php', base64_decode('${Buffer.from(hook).toString('base64')}')) === false) { WP_CLI::error('Cannot write mu-plugin'); } wp_schedule_single_event(time() - 1, 'lab_cron_probe');`);
  let ran = false;
  for (let attempt = 0; attempt < 35; attempt++) {
    if (lab.wp('eval', 'echo get_option("lab_cron_ran", "no");') === 'yes') { ran = true; break; }
    await delay(2000);
  }
  assert.ok(ran, 'The system cron worker should execute due jobs within a minute.');
  await writeFile(lab.configFile, recipe.replace('cron: system', 'cron: manual').replace('redis: true', 'redis: false'));
  lab.cli('up');
  assert.equal(lab.wp('eval', 'echo (int) wp_using_ext_object_cache();'), '0');
  assert.doesNotMatch(lab.cli('status'), /-redis-|-cron-/);
  assert.equal((await fetch(`http://localhost:${port}`)).status, 200);
  assert.ok((await (await fetch(`http://localhost:${mailPort}/api/v1/messages`)).json()).messages.some(message => message.Subject === 'Lab capture test'));
  console.log('PASS: database browser, persistent Redis object cache, captured wp_mail, scheduled cron job, service disabling, and retained inbox.');
} finally { await lab.dispose(); }
