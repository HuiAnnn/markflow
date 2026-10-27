const {test,expect,_electron:electron}=require('@playwright/test');
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
let app,page,profile,proc;
test.beforeAll(async()=>{
 profile=await fs.mkdtemp(path.join(os.tmpdir(),'markflow-focus-'));
 app=await electron.launch({...(process.env.MARKFLOW_APP?{executablePath:process.env.MARKFLOW_APP,args:[`--user-data-dir=${profile}`]}:{args:[path.resolve('.'),`--user-data-dir=${profile}`]}),env:{...process.env,ELECTRON_DISABLE_SECURITY_WARNINGS:'true'}});
 proc=app.process();page=await app.firstWindow();await expect(page.locator('body')).toHaveAttribute('data-ready','true');
});
test.afterAll(async()=>{if(proc?.exitCode===null){const exit=new Promise(resolve=>proc.once('exit',resolve));await app.evaluate(({app})=>app.exit());await exit;}await fs.rm(profile,{recursive:true,force:true,maxRetries:5,retryDelay:100});});
async function command(action){await app.evaluate(({BrowserWindow},action)=>BrowserWindow.getAllWindows()[0].webContents.send('menu-command',action),action);}
async function focusPaint(locator,clipSelector){return locator.evaluate((el,clipSelector)=>{const c=getComputedStyle(el),r=el.getBoundingClientRect(),p=document.querySelector(clipSelector).getBoundingClientRect();const spread=c.outlineStyle==='none'?0:Math.max(0,parseFloat(c.outlineWidth)+parseFloat(c.outlineOffset));return {inside:r.top-spread>=p.top-.5 && r.left-spread>=p.left-.5 && r.right+spread<=p.right+.5,outline:c.outlineStyle,width:parseFloat(c.outlineWidth),border:c.borderColor,shadow:c.boxShadow};},clipSelector);}
async function capture(name){await page.evaluate(()=>new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve))));await fs.mkdir('.local/focus-qa',{recursive:true});const png=await app.evaluate(async({BrowserWindow})=>(await BrowserWindow.getAllWindows()[0].capturePage()).toPNG().toString('base64'));await fs.writeFile(`.local/focus-qa/${name}.png`,Buffer.from(png,'base64'));}
test('search focus is fully visible at the scroll edge, with no clipped outer blue band',async()=>{
 for(const theme of ['light','dark','sepia']){
  await command({action:'set-theme',theme});await expect(page.locator('body')).toHaveAttribute('data-theme',theme);
  await page.locator('[data-tab="search"]').click();await page.locator('#search-input').click();await expect(page.locator('#search-input')).toBeFocused();
  await capture(`search-${theme}`);
  const focusedBorder=await page.locator('.search-field').evaluate(el=>getComputedStyle(el).borderColor);
  await page.keyboard.press('Tab');await page.keyboard.press('Shift+Tab');await expect(page.locator('#search-input')).toBeFocused();
  await page.locator('#search-status').click();expect(await page.locator('.search-field').evaluate(el=>getComputedStyle(el).borderColor)).not.toBe(focusedBorder);await page.locator('#search-input').click();
  expect((await focusPaint(page.locator('.search-field'),'#search-panel')).inside).toBe(true);
  await page.keyboard.type('focus check');await expect(page.locator('#search-input')).toHaveValue('focus check');await page.locator('#search-input').fill('');
  await page.locator('[data-tab="files"]').click();
 }
});
test('keyboard focus on the first outline row stays inside its scroll viewport',async()=>{
 await command({action:'set-theme',theme:'light'});
 await page.locator('#btn-close-outline').focus();await page.keyboard.press('Tab');
 const first=page.locator('#outline-list button').first();await expect(first).toBeFocused();
 await capture('outline-keyboard');const paint=await focusPaint(first,'#outline-list');expect(paint.inside).toBe(true);expect(paint.width).toBeGreaterThanOrEqual(2);expect(paint.outline).not.toBe('none');
});
test('pointer controls do not retain keyboard rings and Tab still highlights settings controls',async()=>{
 await page.locator('#btn-settings').click();await expect(page.locator('#settings-dialog')).toBeVisible();
 await page.keyboard.press('Tab');await expect(page.locator('#theme-select')).toBeFocused();
 expect((await focusPaint(page.locator('#theme-select'),'#settings-dialog')).width).toBeGreaterThanOrEqual(2);
 await page.keyboard.press('Tab');await expect(page.locator('#autosave')).toBeFocused();
 expect((await focusPaint(page.locator('#autosave'),'#settings-dialog')).outline).not.toBe('none');
 await capture('settings-keyboard');await page.keyboard.press('Escape');
 await page.locator('#btn-sidebar').click();expect(await page.locator('#btn-sidebar').evaluate(el=>getComputedStyle(el).outlineStyle)).toBe('none');
 await page.locator('#btn-sidebar').click();
});

test('file and search-result keyboard rings remain visible along list edges at 125% zoom',async()=>{
 const folder=path.join(profile,'samples');await fs.mkdir(folder);await fs.writeFile(path.join(folder,'Example.md'),'# Example\n\nfindme\n');
 await app.evaluate(({dialog},folder)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[folder]});},folder);
 await page.locator('#btn-folder').click();await expect(page.locator('.file-item')).toHaveCount(1);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1.25));
 await page.locator('#btn-refresh').focus();await page.keyboard.press('Tab');await expect(page.locator('.file-item')).toBeFocused();
 expect((await focusPaint(page.locator('.file-item'),'#files-panel')).inside).toBe(true);
 await page.locator('[data-tab="search"]').click();await page.locator('#search-input').fill('findme');await expect(page.locator('.search-result')).toHaveCount(1);
 await page.keyboard.press('Tab');await expect(page.locator('.search-result')).toBeFocused();
 expect((await focusPaint(page.locator('.search-result'),'#search-panel')).inside).toBe(true);
 await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].webContents.setZoomFactor(1));
});
