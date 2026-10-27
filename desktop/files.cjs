const fs = require('node:fs/promises');
const path = require('node:path');
const {createHash, randomUUID} = require('node:crypto');
const MAX_BYTES = 10 * 1024 * 1024;
const markdown = /\.(md|markdown|mdown|txt)$/i;
const ignored = new Set(['node_modules','dist','build','vendor']);
const hash = text => createHash('sha256').update(text).digest('hex');
const normalize = text => text.replace(/^\ufeff/,'').replace(/\r\n/g,'\n');
function inside(root, candidate) {
  const relative = path.relative(root,candidate);
  return relative === '' || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
}
async function readDocument(file) {
  const full = await fs.realpath(file);
  const stat = await fs.stat(full);
  if (!stat.isFile() || stat.size > MAX_BYTES) throw new Error('请选择小于 10 MB 的文本文件。');
  let raw;
  try { raw = new TextDecoder('utf-8',{fatal:true,ignoreBOM:true}).decode(await fs.readFile(full)); }
  catch(error) { if(error.code==='ERR_ENCODING_INVALID_ENCODED_DATA')throw new Error('文件不是有效的 UTF-8 编码，请先转换编码再打开。');throw error; }
  if (raw.includes('\0')) throw new Error('这个文件不是 UTF-8 文本文件。');
  return {path:full,name:path.basename(full),content:normalize(raw),bom:raw.startsWith('\ufeff'),eol:raw.includes('\r\n')?'\r\n':'\n',version:hash(raw)};
}
async function saveDocument(doc, content, target = doc.path, {force = false} = {}) {
  if (!target || typeof content !== 'string' || Buffer.byteLength(content) > MAX_BYTES) throw new Error('文件路径无效或内容超过 10 MB。');
  let destination = path.resolve(target);
  // Follow user-selected symlinks, so atomic rename does not replace the link itself.
  try { destination = await fs.realpath(destination); } catch(error) { if(error.code !== 'ENOENT') throw error; }
  if (destination === doc.path && doc.version && !force) {
    let raw;
    try { raw = await fs.readFile(destination,'utf8'); } catch(error) { if(error.code !== 'ENOENT') throw error; }
    if (raw === undefined || hash(raw) !== doc.version) throw Object.assign(new Error('文件已被其他程序修改或移除。'),{code:'CONFLICT'});
  }
  const normalized = normalize(content);
  const raw = (doc.bom?'\ufeff':'') + normalized.replace(/\n/g,doc.eol || '\n');
  let mode = 0o644;
  try { mode = (await fs.stat(destination)).mode & 0o777; } catch(error) { if(error.code !== 'ENOENT') throw error; }
  const temporary = path.join(path.dirname(destination),`.markflow-${randomUUID()}.tmp`);
  try {
    const handle = await fs.open(temporary,'wx',mode);
    try { await handle.writeFile(raw,'utf8'); await handle.sync(); } finally { await handle.close(); }
    await fs.rename(temporary,destination);
  } finally { await fs.rm(temporary,{force:true}); }
  return {...doc,path:destination,name:path.basename(destination),content:normalized,version:hash(raw)};
}
async function folderTree(root, {limit = 5000} = {}) {
  const realRoot = await fs.realpath(root);
  let count = 0, truncated = false; const skipped = [];
  async function walk(dir, depth = 0) {
    if(depth > 32) {truncated = true; return [];}
    let entries;
    try { entries = await fs.readdir(dir,{withFileTypes:true}); } catch(error) { skipped.push(path.relative(realRoot,dir)); return []; }
    entries = entries.filter(e=>!e.name.startsWith('.') && !ignored.has(e.name) && !e.isSymbolicLink() && (e.isDirectory() || markdown.test(e.name)))
      .sort((a,b)=>Number(b.isDirectory())-Number(a.isDirectory()) || a.name.localeCompare(b.name,'zh-CN'));
    const nodes = [];
    for(const entry of entries) {
      if(count++ >= limit) {truncated = true; break;}
      const file = path.join(dir,entry.name);
      nodes.push({name:entry.name,path:file,type:entry.isDirectory()?'directory':'file',...(entry.isDirectory()?{children:await walk(file,depth+1)}:{})});
    }
    return nodes;
  }
  const nodes = await walk(realRoot);
  return {root:realRoot,name:path.basename(realRoot),nodes,truncated,skipped};
}
async function searchFolder(root, query, {limit = 200} = {}) {
  if(typeof query !== 'string' || !query.trim()) return {results:[],truncated:false,skipped:[]};
  const tree = await folderTree(root); const results = []; const skipped = [...tree.skipped]; let truncated = tree.truncated;
  const needle = query.toLocaleLowerCase();
  async function walk(nodes) {
    for(const node of nodes) {
      if(node.type === 'directory') {if(await walk(node.children)) return true; continue;}
      let doc;
      try {doc = await readDocument(node.path);} catch {skipped.push(path.relative(tree.root,node.path)); continue;}
      const lines = doc.content.split('\n');
      for(let i=0;i<lines.length;i++) {
        const column = lines[i].toLocaleLowerCase().indexOf(needle);
        if(column < 0) continue;
        if(results.length >= limit) {truncated = true; return true;}
        results.push({path:node.path,relativePath:path.relative(tree.root,node.path),line:i+1,column:column+1,text:lines[i].slice(Math.max(0,column-80),column+240)});
      }
    }
    return false;
  }
  await walk(tree.nodes);
  return {results,truncated,skipped};
}
async function resolveResource(root, relative) {
  const decoded = decodeURIComponent(relative);
  if(decoded.includes('\0')) throw new Error('Invalid resource');
  const canonicalRoot = await fs.realpath(root);
  const target = path.resolve(canonicalRoot,decoded);
  if(!inside(canonicalRoot,target)) throw new Error('Resource outside allowed folder');
  const canonical = await fs.realpath(target);
  if(!inside(canonicalRoot,canonical)) throw new Error('Symlink outside allowed folder');
  return canonical;
}
module.exports = {readDocument,saveDocument,folderTree,searchFolder,resolveResource,inside,normalize};
