const {spawn} = require('node:child_process');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
function run(command,args,options={}) {
  return new Promise((resolve,reject)=>{
    const child = spawn(command,args,{...options,shell:false,stdio:['ignore','pipe','pipe']});
    let output=''; let error=''; let timedOut=false;
    const timer=setTimeout(()=>{timedOut=true;child.kill();},60000);
    child.stdout.on('data',v=>{if(output.length<16000)output+=v;});
    child.stderr.on('data',v=>{if(error.length<16000)error+=v;});
    child.on('error',e=>{clearTimeout(timer);reject(e);});
    child.on('close',code=>{clearTimeout(timer);code===0?resolve(output):reject(new Error(timedOut?'导出超时，请检查文档或导出引擎。':error || `导出进程退出：${code}`));});
  });
}
async function findPandoc() {
  for(const command of ['pandoc','/opt/homebrew/bin/pandoc','/usr/local/bin/pandoc']) {
    try {const version=await run(command,['--version']);return {command,version:version.split('\n')[0]};} catch{}
  }
  return null;
}
async function exportPandoc({pandoc,format,content,destination,resourcePath}) {
  const temp=await fs.mkdtemp(path.join(os.tmpdir(),'markflow-export-'));
  try {
    const source=path.join(temp,'document.md'); const output=path.join(temp,`document.${format}`);
    await fs.writeFile(source,content);
    await run(pandoc.command,[source,'--from=markdown','--standalone',`--resource-path=${resourcePath || temp}`,'--output',output],{cwd:resourcePath || temp});
    await fs.copyFile(output,destination);
  } finally {await fs.rm(temp,{recursive:true,force:true});}
}
module.exports={findPandoc,exportPandoc};
