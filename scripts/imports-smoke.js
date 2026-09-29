import { writeFile, mkdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
import { fixture } from './smoke-helpers.js';
const lab = await fixture('imports', 2);
const [port, mailPort] = lab.ports;
const base = `version: 1\nport: ${port}\ncron: manual\nservices:\n  mail: {port: ${mailPort}}\n`;
const content = path.join(lab.temporary, 'backup/wp-content');
const onlyWxr = process.argv.includes('--wxr-only');
try {
  await mkdir(path.join(lab.temporary, 'backup'), { recursive: true });
  if (!onlyWxr) {
    await mkdir(path.join(content, 'uploads'), { recursive: true });
    await mkdir(path.join(content, 'themes/imported-theme'), { recursive: true });
    await writeFile(path.join(content, 'uploads/probe.txt'), 'Restored media');
    const style = '/*\nTheme Name: Imported Theme\nVersion: 1.0.0\n*/';
    await writeFile(path.join(content, 'themes/imported-theme/style.css'), style);
    await writeFile(path.join(content, 'themes/imported-theme/index.php'), '<?php echo "Imported theme is active";');
    await writeFile(lab.configFile, base);
    lab.cli('up');
    lab.wp('option', 'update', 'blogname', 'Original Site');
    lab.wp('eval', `wp_mkdir_p(WP_CONTENT_DIR . '/themes/imported-theme'); file_put_contents(WP_CONTENT_DIR . '/themes/imported-theme/style.css', base64_decode('${Buffer.from(style).toString('base64')}')); file_put_contents(WP_CONTENT_DIR . '/themes/imported-theme/index.php', '<?php echo "Source theme";');`);
    lab.wp('theme', 'activate', 'imported-theme');
    lab.wp('post', 'create', '--post_title=Backup post', '--post_name=backup-post', '--post_status=publish');
    lab.wp('option', 'update', 'home', 'https://source.example.test');
    lab.wp('option', 'update', 'siteurl', 'https://source.example.test');
    lab.wp('option', 'update', 'serialized_url', '{"link":"https://source.example.test/somewhere"}', '--format=json');
    const dump = lab.wp('db', 'export', '-', '--skip-ssl').replace(/\bwp_/g, 'xx_');
    await writeFile(path.join(lab.temporary, 'backup/site.sql'), dump);
    const sqlRecipe = `${base}import:\n  type: sql\n  path: backup/site.sql\n  content: backup/wp-content\n  tablePrefix: xx_\n`;
    await writeFile(lab.configFile, sqlRecipe);
    lab.cli('up', [], false);
    assert.equal(lab.wp('option', 'get', 'blogname'), 'Original Site');
    lab.cli('reset', ['--yes']);
    assert.equal(lab.wp('option', 'get', 'blogname'), 'Original Site');
    assert.equal(lab.wp('option', 'get', 'stylesheet'), 'imported-theme');
    assert.equal(lab.wp('option', 'get', 'home'), `http://localhost:${port}`);
    assert.equal(JSON.parse(lab.wp('option', 'get', 'serialized_url', '--format=json')).link, `http://localhost:${port}/somewhere`);
    assert.equal(await (await fetch(`http://localhost:${port}/wp-content/uploads/probe.txt`)).text(), 'Restored media');
    assert.match(await (await fetch(`http://localhost:${port}`)).text(), /Imported theme is active/);
    const state = JSON.parse(await readFile(path.join(lab.directory, 'state.json')));
    const login = await fetch(`http://localhost:${port}/wp-login.php`, { method: 'POST', redirect: 'manual', body: new URLSearchParams({ log: 'admin', pwd: state.credentials.admin }) });
    assert.equal(login.status, 302);
    lab.wp('option', 'update', 'blogname', 'Edited clone');
    await rename(path.join(lab.temporary, 'backup/site.sql'), path.join(lab.temporary, 'backup/archived.sql'));
    lab.cli('up');
    assert.equal(lab.wp('option', 'get', 'blogname'), 'Edited clone');
    console.log('PASS: SQL clone, custom table prefix, serialized URL rewrites, theme/media restore, lab login, and no reimport on restart.');
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:excerpt="http://wordpress.org/export/1.2/excerpt/" xmlns:content="http://purl.org/rss/1.0/modules/content/" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:wp="http://wordpress.org/export/1.2/">
<channel><title>Export</title><link>https://source.example.test</link><description>Fixture</description><language>en-US</language><wp:wxr_version>1.2</wp:wxr_version><wp:base_site_url>https://source.example.test</wp:base_site_url><wp:base_blog_url>https://source.example.test</wp:base_blog_url>
<item><title>XML imported post</title><link>https://source.example.test/xml-post</link><dc:creator>admin</dc:creator><guid isPermaLink="false">https://source.example.test/?p=101</guid><content:encoded><![CDATA[Hello from WXR]]></content:encoded><excerpt:encoded></excerpt:encoded><wp:post_id>101</wp:post_id><wp:post_date>2026-01-01 12:00:00</wp:post_date><wp:post_date_gmt>2026-01-01 12:00:00</wp:post_date_gmt><wp:post_name>xml-post</wp:post_name><wp:status>publish</wp:status><wp:post_type>post</wp:post_type><wp:post_parent>0</wp:post_parent></item></channel></rss>`;
  await writeFile(path.join(lab.temporary, 'backup/site.xml'), xml);
  await writeFile(lab.configFile, `${base}import: {type: wxr, path: backup/site.xml}\n`);
  lab.cli(onlyWxr ? 'up' : 'reset', onlyWxr ? [] : ['--yes']);
  assert.equal(lab.wp('post', 'list', '--name=xml-post', '--format=count'), '1');
  await rename(path.join(lab.temporary, 'backup/site.xml'), path.join(lab.temporary, 'backup/archived.xml'));
  lab.cli('up');
  assert.equal(lab.wp('post', 'list', '--name=xml-post', '--format=count'), '1');
  console.log('PASS: WXR import and restart without duplicate posts.');
} finally { await lab.dispose(); }
