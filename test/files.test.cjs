const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const {readDocument, saveDocument, folderTree, searchFolder, resolveResource} = require('../desktop/files.cjs');
async function fixture(t) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'markflow-test-'));
  t.after(() => fs.rm(dir, {recursive: true, force: true}));
  return fs.realpath(dir);
}
test('save and reopen preserve UTF-8, BOM and CRLF without duplicate newlines', async t => {
  const dir = await fixture(t); const file = path.join(dir,'你好.md');
  await fs.writeFile(file, '\ufeff# 标题\r\n正文\r\n');
  const doc = await readDocument(file);
  assert.equal(doc.content, '# 标题\n正文\n');
  const saved = await saveDocument(doc, '# 标题\n新的正文\n');
  assert.equal(await fs.readFile(file,'utf8'), '\ufeff# 标题\r\n新的正文\r\n');
  assert.equal((await readDocument(file)).content, '# 标题\n新的正文\n');
  assert.notEqual(saved.version, doc.version);
});
test('refuses to silently overwrite a file changed by another editor', async t => {
  const dir = await fixture(t); const file = path.join(dir,'note.md');
  await fs.writeFile(file,'original'); const doc = await readDocument(file);
  await fs.writeFile(file,'external');
  await assert.rejects(saveDocument(doc,'mine'), {code:'CONFLICT'});
  assert.equal(await fs.readFile(file,'utf8'),'external');
  await saveDocument(doc,'mine',file,{force:true});
  assert.equal(await fs.readFile(file,'utf8'),'mine');
});
test('save-as leaves original unchanged and retains file permissions on ordinary save', async t => {
  const dir = await fixture(t); const file = path.join(dir,'one.md'); const copy = path.join(dir,'two.md');
  await fs.writeFile(file,'one',{mode:0o600}); const doc = await readDocument(file);
  await saveDocument(doc,'two',copy);
  assert.equal(await fs.readFile(file,'utf8'),'one');
  await saveDocument(doc,'changed');
  assert.equal((await fs.stat(file)).mode & 0o777,0o600);
  assert.deepEqual((await fs.readdir(dir)).sort(),['one.md','two.md']);
});
test('folder tree and literal search exclude hidden files, dependencies and symlinks', async t => {
  const dir = await fixture(t);
  await fs.mkdir(path.join(dir,'chapter'));
  await fs.mkdir(path.join(dir,'node_modules'));
  await fs.writeFile(path.join(dir,'chapter','a.md'),'Title\nNeedle [x]\nneedle [x]');
  await fs.writeFile(path.join(dir,'b.markdown'),'NEEDLE [x]');
  await fs.writeFile(path.join(dir,'.hidden.md'),'needle [x]');
  await fs.writeFile(path.join(dir,'ignored.js'),'needle [x]');
  await fs.writeFile(path.join(dir,'node_modules','dep.md'),'needle [x]');
  await fs.symlink(path.join(dir,'b.markdown'),path.join(dir,'link.md'));
  const tree = await folderTree(dir);
  assert.deepEqual(tree.nodes.map(x=>x.name),['chapter','b.markdown']);
  assert.equal(tree.nodes[0].children[0].name,'a.md');
  const search = await searchFolder(dir,'needle [x]');
  assert.deepEqual(search.results.map(x=>[x.relativePath,x.line]),[['chapter/a.md',2],['chapter/a.md',3],['b.markdown',1]]);
  const limited = await searchFolder(dir,'needle',{limit:1});
  assert.equal(limited.results.length,1); assert.equal(limited.truncated,true);
});
test('resource resolution rejects traversal and symlink escapes', async t => {
  const dir = await fixture(t); const root = path.join(dir,'root'); await fs.mkdir(root);
  await fs.writeFile(path.join(root,'image.png'),'image'); await fs.writeFile(path.join(dir,'secret'),'private');
  await fs.symlink(path.join(dir,'secret'),path.join(root,'link'));
  assert.equal(await resolveResource(root,'image.png'),path.join(root,'image.png'));
  await assert.rejects(resolveResource(root,'../secret'));
  await assert.rejects(resolveResource(root,'%2e%2e/secret'));
  await assert.rejects(resolveResource(root,'link'));
});
test('rejects invalid UTF-8 instead of replacing bytes and corrupting the original', async t => {
  const dir=await fixture(t);const file=path.join(dir,'legacy.md');
  await fs.writeFile(file,Buffer.from([0x63,0x61,0x66,0xe9]));
  await assert.rejects(readDocument(file),/UTF-8/);
  assert.deepEqual(await fs.readFile(file),Buffer.from([0x63,0x61,0x66,0xe9]));
});
