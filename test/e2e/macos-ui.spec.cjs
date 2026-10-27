const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');
let app,page,dir,processHandle;
test.describe.configure({mode:'serial'});
test.beforeAll(async()=>{
 dir=await fs.mkdtemp(path.join(os.tmpdir(),'markflow-ui-'));
 app=await electron.launch({...(process.env.MARKFLOW_APP?{executablePath:process.env.MARKFLOW_APP,args:[`--user-data-dir=${dir}`]}:{args:[path.resolve('.'),`--user-data-dir=${dir}`]}),env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
 processHandle=app.process();page=await app.firstWindow();await expect(page.locator('body')).toHaveAttribute('data-ready','true');
});
test.afterAll(async()=>{if(processHandle?.exitCode===null){const exited=new Promise(resolve=>processHandle.once('exit',resolve));await app.evaluate(({app})=>app.exit()).catch(()=>processHandle.kill());await exited;}await fs.rm(dir,{recursive:true,force:true,maxRetries:6,retryDelay:150});});
async function nativeCommand(command){await app.evaluate(({BrowserWindow},command)=>BrowserWindow.getAllWindows()[0].webContents.send('menu-command',command),command);}
async function capture(name){const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await fs.writeFile(`docs/qa/${name}.png`,Buffer.from(png,'base64'));}
test('appearance uses native radio menu and follows the system',async()=>{
 await expect(page.locator('#btn-appearance')).toHaveAttribute('aria-haspopup','menu');
 await expect(page.locator('#appearance-name')).toHaveText('跟随系统');
 await app.evaluate(({Menu})=>{globalThis.popupOriginal=Menu.prototype.popup;Menu.prototype.popup=function(options){globalThis.capturedPopup=this;globalThis.popupCallback=options.callback;};});
 await page.locator('#btn-appearance').click();
 await expect.poll(()=>app.evaluate(()=>globalThis.capturedPopup?.items.map(x=>x.label))).toEqual(['跟随系统','浅色','深色','暖纸']);
 expect(await app.evaluate(()=>globalThis.capturedPopup.items[0].checked)).toBe(true);
 await app.evaluate(()=>{globalThis.capturedPopup.items.find(x=>x.id==='theme-dark').click();globalThis.popupCallback?.();});
 await expect(page.locator('body')).toHaveAttribute('data-theme','dark');
 await expect(page.locator('#appearance-name')).toHaveText('深色');
 await capture('02-dark');
 await page.reload();await expect(page.locator('body')).toHaveAttribute('data-ready','true');
 await expect(page.locator('body')).toHaveAttribute('data-theme','dark');
 await nativeCommand({action:'set-theme',theme:'system'});
 await app.evaluate(({nativeTheme})=>{nativeTheme.themeSource='light';});
 await expect(page.locator('body')).toHaveAttribute('data-theme','light');
 await app.evaluate(({Menu,nativeTheme})=>{Menu.prototype.popup=globalThis.popupOriginal;nativeTheme.themeSource='system';});
 await nativeCommand({action:'set-theme',theme:'light'});
 await expect(page.locator('body')).toHaveAttribute('data-theme','light');await capture('01-light');
});
test('settings traps focus, Escape closes and restores the triggering button',async()=>{
 await page.locator('#btn-settings').click();
 const sheet=page.getByRole('dialog',{name:'设置'});await expect(sheet).toBeVisible();
 await page.keyboard.press('Tab');expect(await page.evaluate(()=>document.querySelector('#settings-dialog').contains(document.activeElement))).toBe(true);
 await capture('03-settings');await page.keyboard.press('Escape');await expect(sheet).toBeHidden();
 await expect(page.locator('#btn-settings')).toBeFocused();
});
test('source and pane controls expose state and focus mode restores layout',async()=>{
 await page.locator('#btn-edit').click();await expect(page.locator('#btn-edit')).toHaveAttribute('aria-pressed','true');
 await expect(page.locator('.vditor-sv')).toHaveAttribute('aria-label','Markdown 源码编辑器');await expect(page.locator('.vditor-preview')).toBeHidden();await capture('04-source');
 await page.locator('#btn-preview').click();await expect(page.locator('#btn-preview')).toHaveAttribute('aria-pressed','true');
 await page.locator('#btn-outline').click();await expect(page.locator('#outline')).toBeHidden();
 await nativeCommand('focus');await expect(page.locator('#sidebar')).toBeHidden();
 await page.keyboard.press('Escape');await expect(page.locator('#sidebar')).toBeVisible();await expect(page.locator('#outline')).toBeHidden();
 await page.locator('#btn-outline').click();await expect(page.locator('#outline')).toBeVisible();
});
test('small windows and zoom keep toolbar controls inside bounds',async()=>{
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(920,640));
 await expect(page.locator('body')).toHaveAttribute('data-compact','true');
 await capture('05-compact');
 for(const id of ['btn-sidebar','btn-save','btn-edit','btn-export','btn-more']){const rect=await page.locator('#'+id).boundingBox();expect(rect.x).toBeGreaterThanOrEqual(0);expect(rect.x+rect.width).toBeLessThanOrEqual(921);expect(rect.height).toBeGreaterThanOrEqual(28);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
 await app.evaluate(({BrowserWindow})=>{const w=BrowserWindow.getAllWindows()[0];w.setSize(1320,860);w.webContents.setZoomFactor(1.25);});
 await expect.poll(()=>page.evaluate(()=>Math.round(innerWidth))).toBe(1056);
  await expect.poll(()=>page.evaluate(()=>document.documentElement.scrollWidth>innerWidth)).toBe(false);
  for(const id of ['btn-sidebar','btn-save','btn-edit','btn-export','btn-more']){const rect=await page.locator('#'+id).boundingBox();expect(rect.x+rect.width).toBeLessThanOrEqual(1057);}
 await capture('06-zoom');
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
});
test('sidebar tabs are keyboard accessible and no-folder search has an actionable empty state',async()=>{
 await page.locator('[data-tab="files"]').focus();await page.keyboard.press('ArrowRight');
 await expect(page.locator('[data-tab="search"]')).toHaveAttribute('aria-selected','true');
 await expect(page.locator('#search-open-folder')).toBeVisible();await capture('07-search-empty');
 await page.keyboard.press('Escape');
 await page.locator('[data-tab="files"]').click();
});
