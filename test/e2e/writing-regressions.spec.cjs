const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
let app,page,dir,file,proc;
test.beforeEach(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'markflow-writing-'));file=path.join(dir,'Draft.md');await fs.writeFile(file,'Original text\n');
 app=await electron.launch({...(process.env.MARKFLOW_APP?{executablePath:process.env.MARKFLOW_APP,args:[`--user-data-dir=${path.join(dir,'profile')}`]}:{args:[path.resolve('.'),`--user-data-dir=${path.join(dir,'profile')}`]}),env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});proc=app.process();page=await app.firstWindow();await expect(page.locator('body')).toHaveAttribute('data-ready','true');
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});},file);await page.locator('#btn-open').click();await expect(page.locator('#filename')).toHaveText('Draft.md');await page.locator('#btn-edit').click();await expect(page.locator('#st-mode')).toContainText('源码');
});
test.afterEach(async()=>{if(proc?.exitCode===null){const exit=new Promise(resolve=>proc.once('exit',resolve));await app.evaluate(({app})=>app.exit());await exit;}await fs.rm(dir,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function command(action){await app.evaluate(({BrowserWindow},action)=>BrowserWindow.getAllWindows()[0].webContents.send('menu-command',action),action);}
async function append(text){await page.locator('.vditor-sv').click();await page.keyboard.press('Meta+End');await page.keyboard.insertText(text);await expect(page.locator('#st-dirty')).toBeVisible();}
test('layout commands keep pending autosave and background saving keeps the caret',async()=>{
 await command('autosave');await append(' autosaved');await command('sidebar');
 await expect.poll(()=>fs.readFile(file,'utf8')).toContain('autosaved');
 await expect(page.locator('.vditor-sv')).toBeFocused();await page.keyboard.insertText(' continued');
 await expect.poll(()=>fs.readFile(file,'utf8')).toContain('autosaved continued');
});
test('mode roundtrip and PDF export retain undo, including the native Edit menu',async()=>{
 await append(' undoable');await page.waitForTimeout(400);
 await page.locator('#btn-preview').click();await page.locator('#btn-edit').click();
 await expect(page.locator('.vditor-sv')).toBeFocused();
 await page.keyboard.press('Meta+z');await expect(page.locator('.vditor-sv')).not.toContainText('undoable');await expect(page.locator('#st-dirty')).toBeHidden();
 await page.keyboard.press('Meta+Shift+z');await expect(page.locator('.vditor-sv')).toContainText('undoable');
 await app.evaluate(({dialog},file)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:file});},path.join(dir,'test.pdf'));
 await command('pdf-native');await expect.poll(()=>fs.readFile(path.join(dir,'test.pdf')).then(b=>b.subarray(0,5).toString()).catch(()=>'')).toBe('%PDF-');
 await expect(page.locator('#st-mode')).toContainText('源码');await page.waitForTimeout(300);
 await app.evaluate(({Menu})=>Menu.getApplicationMenu().items.find(i=>i.label==='编辑').submenu.items.find(i=>i.label==='撤销').click());
 await expect(page.locator('.vditor-sv')).not.toContainText('undoable');
});
test('typewriter spacing is excluded from print layout',async()=>{
 await command('typewriter');await page.locator('#btn-preview').click();await page.emulateMedia({media:'print'});
 expect(await page.locator('.vditor-ir').evaluate(e=>getComputedStyle(e).paddingBottom)).toBe('0px');
});

test('canceling an indirect save conflict pauses autosave until another edit',async()=>{
 await command('autosave');await append(' pending');await fs.writeFile(file,'External version\n');
 await app.evaluate(({dialog})=>{globalThis.prompts=[];dialog.showMessageBox=async(_w,options)=>{globalThis.prompts.push(options.message);return {response:globalThis.prompts.length===1?0:2};};});
 await command('close');await expect.poll(()=>app.evaluate(()=>globalThis.prompts.length)).toBe(2);
 await page.waitForTimeout(1800);expect(await app.evaluate(()=>globalThis.prompts.length)).toBe(2);
 await expect(page.locator('#st-save')).toHaveText('已编辑');expect(await fs.readFile(file,'utf8')).toBe('External version\n');
 await append(' again');await expect.poll(()=>app.evaluate(()=>globalThis.prompts.length)).toBe(3);
});
