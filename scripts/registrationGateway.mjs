import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root=join(dirname(fileURLToPath(import.meta.url)),'..');
const worker=join(root,'scripts','registration_worker.py');
let busy=false;
function pythonPath() {
  return process.env.ATLAS_REGISTRATION_PYTHON?.trim() || join(root,'.venv-registration',process.platform==='win32'?'Scripts/python.exe':'bin/python');
}
function json(response,status,value) {
  if(response.destroyed)return;
  response.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  response.end(JSON.stringify(value));
}
function execute(args,body,response) {
  return new Promise((resolve,reject)=>{
    const child=spawn(pythonPath(),[worker,...args],{windowsHide:true,env:{...process.env,PYTHONUNBUFFERED:'1'},stdio:['pipe','pipe','pipe']});
    let stdout='',stderr='',settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timer);response?.off('close',abort);error?reject(error):resolve(value);};
    const abort=()=>{if(!response.writableFinished){child.kill();finish(new Error('配准已取消'));}};
    const timer=setTimeout(()=>{child.kill();finish(new Error('自动配准超时，已保留原位姿'));},args.length?10000:180000);
    response?.once('close',abort);
    child.stdout.setEncoding('utf8');child.stderr.setEncoding('utf8');
    child.stdout.on('data',part=>{stdout+=part;if(stdout.length>1000000){child.kill();finish(new Error('Invalid worker output'));}});
    child.stderr.on('data',part=>{stderr=(stderr+part).slice(-3000);});
    child.on('error',error=>finish(error));
    child.on('close',code=>{if(code!==0){finish(new Error(stderr.trim()||'配准进程未完成'));return;}try{finish(null,JSON.parse(stdout));}catch{finish(new Error('Invalid worker JSON'));}});
    child.stdin.on('error',()=>{});child.stdin.end(body?JSON.stringify(body):'');
  });
}
export async function registrationStatus() {
  if(!existsSync(pythonPath()))return {configured:false,weightsRequired:false,reason:'请先运行 Setup-Registration 启动器安装独立配准环境'};
  try {const check=await execute(['--check']);return {configured:check.ready===true,mode:'local',weightsRequired:false,label:'球面 NID 自动精配准 · 无需权重',algorithmVersion:check.algorithmVersion};}
  catch{return {configured:false,weightsRequired:false,reason:'配准环境依赖未就绪，请运行 Setup-Registration 启动器'};}
}
export function validateRegistrationRequest(body) {
  const vec=(v,n)=>Array.isArray(v)&&v.length===n&&v.every(x=>typeof x==='number'&&Number.isFinite(x)&&Math.abs(x)<1e8);
  if(!body||body.schemaVersion!=='registration/2.0'||typeof body.frameId!=='string'||!body.frameId||body.frameId.length>256||
    !body.prior||!vec(body.prior.position,3)||!vec(body.prior.rotation,3)||
    !['intensity','rgb-luminance'].includes(body.signal)||
    typeof body.imageDataUrl!=='string'||!/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/.test(body.imageDataUrl)||
    !Array.isArray(body.points)||body.points.length<1000||body.points.length>40000||body.points.some(point=>!vec(point,3))||
    !Array.isArray(body.values)||body.values.length!==body.points.length||body.values.some(value=>typeof value!=='number'||!Number.isFinite(value)))
    throw new Error('自动配准输入无效：需要粗位姿、全景、1000–40000 个 XYZ 与对应强度/真实颜色值');
  return body;
}
export async function handleRegistration(request,response) {
  if(request.method==='GET'){json(response,200,await registrationStatus());return;}
  if(request.method!=='POST'){response.writeHead(405,{Allow:'GET, POST'});response.end();return;}
  const host=request.headers.host??'';
  if(!/^127\.0\.0\.1:\d+$/.test(host)||request.headers.origin!==`http://${host}`){
    json(response,403,{error:'仅允许本机同源请求'});return;
  }
  if(busy){json(response,409,{error:'配准服务正在处理另一帧，请稍后重试'});return;}
  busy=true;
  try {
    if(!existsSync(pythonPath())){json(response,503,{error:'请先运行 Setup-Registration 启动器'});return;}
    let size=0;const chunks=[];
    for await(const chunk of request){size+=chunk.length;if(size>12*1024*1024)throw new Error('配准请求超过 12 MiB');chunks.push(chunk);}
    const body=validateRegistrationRequest(JSON.parse(Buffer.concat(chunks).toString('utf8')));
    const result=await execute([],body,response);json(response,200,result);
  } catch(error){json(response,422,{error:error instanceof Error?error.message:'自动配准失败'});}
  finally{busy=false;}
}
