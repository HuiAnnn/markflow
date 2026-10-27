const {test,expect,_electron:electron} = require('@playwright/test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
test.describe.configure({mode:'serial'});
let app,page,dir,file,appProcess;
async function openChoice(paths) {await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:paths});},paths);}
async function saveChoice(filePath) {await app.evaluate(({dialog},filePath)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath});},filePath);}
async function messageChoice(response) {await app.evaluate(({dialog},response)=>{dialog.showMessageBox=async()=>({response});},response);}
async function sourceText(text) {
 const editor=page.locator('.vditor-sv');await editor.click();await page.keyboard.press('Meta+A');await page.keyboard.press('Backspace');
 const lines=text.split('\n');for(let i=0;i<lines.length;i++){if(i)await page.keyboard.press('Enter');if(lines[i])await page.keyboard.insertText(lines[i]);}
}
async function command(action) {
 const labels={'source':'切换源码模式','new':'新建','open':'打开…','save':'保存','save-as':'另存为…','export-html':'HTML 网页…','export-docx':'Word 文稿…','pdf-native':'PDF…','close':'关闭窗口'};
 if(labels[action])await app.evaluate(({Menu},label)=>{function find(menu){for(const item of menu.items){if(item.label===label)return item;if(item.submenu){const child=find(item.submenu);if(child)return child;}}}const item=find(Menu.getApplicationMenu());if(!item)throw new Error('Menu item missing: '+label);item.click();},labels[action]);
 else await app.evaluate(({BrowserWindow},action)=>BrowserWindow.getAllWindows()[0].webContents.send('menu-command',action),action);
}
test.beforeAll(async()=>{
  dir=await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(),'markflow-e2e-')));
  file=path.join(dir,'笔记.md');
  await fs.writeFile(file,'# 本地笔记\n\n原始内容\n');
  await fs.mkdir(path.join(dir,'章节'));
  await fs.writeFile(path.join(dir,'章节','搜索.md'),'# 搜索文档\n\n命中测试 target\n');
  app=await electron.launch({...(process.env.MARKFLOW_APP?{executablePath:process.env.MARKFLOW_APP,args:[`--user-data-dir=${path.join(dir,'profile')}`]}:{args:[path.resolve('.'),`--user-data-dir=${path.join(dir,'profile')}`]}),env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
  appProcess=app.process();page=await app.firstWindow();await messageChoice(2);
});
test.afterEach(async({},info)=>{if(info.status!==info.expectedStatus && page){await page.screenshot({path:info.outputPath('failure.png')});await fs.writeFile(info.outputPath('dom.txt'),await page.locator('body').innerText());}});
test.afterAll(async()=>{if(appProcess && appProcess.exitCode===null) {const exited=new Promise(resolve=>appProcess.once('exit',resolve));await app.evaluate(({app})=>app.exit(0)).catch(()=>appProcess.kill());await exited;} if(dir) await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:150});});
test('local editor initializes with advanced Markdown, without failed assets',async()=>{
  const failures=[]; page.on('requestfailed',r=>failures.push(r.url()));
  await expect(page.locator('body')).toHaveAttribute('data-ready','true');
  await expect(page.locator('.vditor-ir h1')).toContainText('写下');
  await expect(page.locator('.vditor-ir table')).toBeVisible();
  await expect(page.locator('.vditor-ir .katex').first()).toBeVisible();
  await expect(page.locator('.vditor-ir .language-mermaid svg').first()).toBeVisible();
  expect(failures.filter(x=>x.startsWith('app:'))).toEqual([]);
  expect(await page.evaluate(()=>typeof window.require)).toBe('undefined');
  await page.screenshot({path:'docs/markflow-preview.png',scale:'css'});
});
test('open, edit, save through native menu and reopen real disk file',async()=>{
  await openChoice([file]); await page.locator('#btn-open').click();
  await expect(page.locator('#filename')).toContainText('笔记.md');
  await command('source');
  await expect(page.locator('#st-mode')).toContainText('源码');
  const editor=page.locator('.vditor-sv');
  await sourceText('# 已保存标题\n\n新的磁盘内容\n');
  await expect(page.locator('#st-dirty')).toBeVisible();
  await command('save');
  await expect(page.locator('#st-dirty')).toBeHidden();
  expect(await fs.readFile(file,'utf8')).toMatch(/^# 已保存标题\n\n新的磁盘内容\n+$/);
  await command('new');
  await openChoice([file]); await command('open');
  await expect(editor).toContainText('新的磁盘内容');
  await command('source');
  await expect(page.locator('.vditor-ir h1')).toContainText('已保存标题');
});
test('folder tree searches and navigates to source line',async()=>{
  await openChoice([dir]); await page.locator('#btn-folder').click();
  await expect(page.locator('#folder-name')).toContainText(path.basename(dir));
  await page.locator('[data-tab="search"]').click();
  await page.locator('#search-input').fill('target');
  await expect(page.locator('.search-result')).toHaveCount(1);
  await page.locator('.search-result').click();
  await expect(page.locator('#filename')).toContainText('搜索.md');
  await expect(page.locator('#st-position')).toContainText('3');
  await expect(page.locator('.vditor-sv')).toContainText('命中测试 target');
});
test('cancel preserves dirty text; save-as creates file; theme and source roundtrip',async()=>{
  await sourceText('# 不要丢失\n\n重要草稿\n');
  await messageChoice(2); await command('new');
  await expect(page.locator('.vditor-sv')).toContainText('重要草稿');
  const destination=path.join(dir,'另存为.md'); await saveChoice(destination); await command('save-as');
  await expect(page.locator('#filename')).toContainText('另存为.md');
  expect(await fs.readFile(destination,'utf8')).toContain('重要草稿');
  await command('source');
  await expect(page.locator('.vditor-ir h1')).toContainText('不要丢失');
  await page.locator('#btn-settings').click();await page.locator('#theme-select').selectOption('dark');await page.keyboard.press('Escape');
  await expect(page.locator('body')).toHaveAttribute('data-theme','dark');
  await page.screenshot({path:'test-results/markflow-desktop.png'});
});
test('mode roundtrip keeps an unsaved draft dirty, and reopening same file saves latest buffer',async()=>{
  await command('source');
  await sourceText('# 尚未保存的修改\n\n不能丢失\n');
  await expect(page.locator('#st-dirty')).toBeVisible();
  await command('source');await expect(page.locator('#st-mode')).toContainText('即时');
  await command('source');await expect(page.locator('#st-mode')).toContainText('源码');
  await sourceText('# 尚未保存的修改\n\n不能丢失\n');
  await expect(page.locator('#st-dirty')).toBeVisible();
  await openChoice([path.join(dir,'另存为.md')]);await messageChoice(0);await command('open');
  await expect(page.locator('#st-dirty')).toBeHidden();
  await expect(page.locator('.vditor-sv')).toContainText('不能丢失');
  expect(await fs.readFile(path.join(dir,'另存为.md'),'utf8')).toContain('不能丢失');
});
test('relative local images render and portable HTML embeds their bytes',async()=>{
  await fs.mkdir(path.join(dir,'assets'));
  await fs.writeFile(path.join(dir,'assets','dot.svg'),'<svg xmlns="http://www.w3.org/2000/svg" width="40" height="40"><rect width="40" height="40" fill="green"/></svg>');
  const imageNote=path.join(dir,'章节','图片.md');await fs.writeFile(imageNote,'# 图片测试\n\n![dot](../assets/dot.svg)\n');
  await openChoice([imageNote]);await command('open');await expect(page.locator('#filename')).toContainText('图片.md');
  await command('source');
  await expect(page.locator('.vditor-ir img')).toBeVisible();
  await expect.poll(()=>page.locator('.vditor-ir img').evaluate(el=>el.naturalWidth)).toBe(40);
  const html=path.join(dir,'portable.html');await saveChoice(html);await command('export-html');
  await expect.poll(()=>fs.readFile(html,'utf8').catch(()=>'')).toContain('data:image/svg+xml;base64,');
});
test('native PDF exports real bytes and missing Pandoc gives a useful message',async()=>{
  const pdf=path.join(dir,'export.pdf');await saveChoice(pdf);await command('pdf-native');
  await expect.poll(()=>fs.readFile(pdf).then(x=>x.subarray(0,5).toString()).catch(()=>'')).toBe('%PDF-');
  if(await require('../../desktop/exports.cjs').findPandoc())return;
  await app.evaluate(({dialog})=>{globalThis.lastMessage=null;dialog.showMessageBox=async(_window,options)=>{globalThis.lastMessage=options;return {response:0};};});
  await command('export-docx');
  await expect.poll(()=>app.evaluate(()=>globalThis.lastMessage?.message || '')).toContain('Pandoc');
});
test('autosave reaches disk, and closing can cancel then save changes',async()=>{
  await command('source');await expect(page.locator('#st-mode')).toContainText('源码');
  await sourceText('# 自动保存\n\n已写入磁盘\n');
  await page.locator('#btn-settings').click();await page.locator('#autosave').check();await page.keyboard.press('Escape');
  const currentFile=path.join(dir,'章节','图片.md');
  await expect.poll(()=>fs.readFile(currentFile,'utf8')).toContain('已写入磁盘');
  await expect(page.locator('#st-dirty')).toBeHidden();
  await page.locator('#btn-settings').click();await page.locator('#autosave').uncheck();await page.keyboard.press('Escape');
  await sourceText('# 关闭前保存\n\n最终内容\n');
  await messageChoice(2);await command('close');
  await expect(page.locator('#st-dirty')).toBeVisible();
  expect(app.windows().length).toBe(1);
  await messageChoice(0);
  const closing=app.waitForEvent('close');await command('close');await closing;
  expect(await fs.readFile(currentFile,'utf8')).toContain('最终内容');
});
