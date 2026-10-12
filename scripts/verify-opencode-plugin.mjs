import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const pkg = JSON.parse(await readFile(new URL('package.json', root), 'utf8'));
const module = await import(new URL(pkg.main, root));
const plugin = module.default;
assert.equal((await import(new URL('index.js', root))).default, plugin);
await plugin.setup({}); // V1 loaders may invoke setup with a legacy context.
await plugin.setup();
assert.equal(plugin?.id, 'nax-toolkit', 'OpenCode 2 needs a default definition with an id');
assert.equal(typeof plugin.setup, 'function');
assert.equal(typeof plugin.server, 'function', 'OpenCode 1.18.29+ needs server()');

const skillsDir = fileURLToPath(new URL('skills/', root)).replace(/\/$/, '');
for (const load of [plugin.server, (await import(new URL('.opencode/plugins/nax-toolkit.js', root))).NaxToolkitPlugin]) {
  const hooks = await load({});
  for (const config of [{}, { skills: { paths: ['/existing'], urls: ['https://example.com'] } }]) {
    await hooks.config(config);
    await hooks.config(config);
    assert.equal(config.skills.paths.filter((value) => value === skillsDir).length, 1);
    if (config.skills.urls) {
      assert.deepEqual(config.skills.paths, ['/existing', skillsDir]);
      assert.deepEqual(config.skills.urls, ['https://example.com']);
    }
  }
}

let transform;
await plugin.setup({ skill: { async transform(callback) { transform = callback; } } });
assert.equal(typeof transform, 'function');
for (let replay = 0; replay < 2; replay++) {
  const registered = [];
  const result = transform({ add(skill) { registered.push(skill); } });
  assert.equal(result, undefined, 'Transforms must be synchronous and replayable');
  const names = (await readdir(new URL('skills/', root), { withFileTypes: true }))
    .filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort();
  assert.deepEqual(registered.map((skill) => skill.id).sort(), names);
  for (const skill of registered) {
    const source = await readFile(skill.path, 'utf8');
    assert.equal(skill.name, skill.id);
    assert.equal(skill.description, source.match(/^description: (.+)$/m)[1]);
    assert.equal(skill.content, source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, '').trim());
    assert.equal(skill.autoinvoke, true);
    assert.ok(skill.path.startsWith(skillsDir));
  }
}
console.log('OpenCode V2 registration and V1 compatibility verified.');
