import {createServer} from 'node:http';
import {resolve, join} from 'node:path';
import {mkdir} from 'node:fs/promises';
import {createServer as createViteServer} from 'vite';
import {bundle} from '@remotion/bundler';
import {selectComposition, renderMedia} from '@remotion/renderer';
import {ProjectSchema} from '../domain/project';
import {buildRenderPlan} from '../application/commands';
import {saveProject, loadProject, listProjects} from './storage';
const root=resolve('data/projects');
await mkdir(root,{recursive:true});
const temp=resolve('.tmp');
await mkdir(temp,{recursive:true});
process.env.TEMP=temp; process.env.TMP=temp;
const port=Number(process.env.CHATCINEMA_PORT ?? 4173);
const hmrPort=Number(process.env.CHATCINEMA_HMR_PORT ?? 24678);
const vite=await createViteServer({server:{middlewareMode:true,ws:{port:hmrPort}},appType:'spa'});
const server=createServer(async(req,res)=>{
  if(!req.url?.startsWith('/api/')) return vite.middlewares(req,res,()=>{res.statusCode=404;res.end()});
  const json=(status:number,body:unknown)=>{res.writeHead(status,{'Content-Type':'application/json'});res.end(JSON.stringify(body))};
  try {
    const url=new URL(req.url,'http://localhost');
    if(req.method==='GET' && url.pathname==='/api/projects') return json(200,await listProjects(root));
    if(req.method==='GET' && url.pathname==='/api/project') return json(200,await loadProject(root,url.searchParams.get('id') ?? ''));
    if(req.method==='POST') {
      let body=''; for await(const chunk of req){body+=chunk;if(body.length>5_000_000) throw Error('Слишком большой запрос')}
      const project=ProjectSchema.parse(JSON.parse(body));
      if(url.pathname==='/api/project'){await saveProject(root,project);return json(200,{ok:true})}
      if(url.pathname==='/api/export'){
        const plan=buildRenderPlan(project); if(!plan.length) throw Error('Таймлайн пуст');
        await saveProject(root,project);
        const outputDir=join(root,project.id,'exports');await mkdir(outputDir,{recursive:true});
        const outputLocation=join(outputDir,`export-${Date.now()}.mp4`);
        const serveUrl=await bundle({entryPoint:resolve('src/renderer/index.tsx'),publicDir:resolve('public')});
        const inputProps={project,plan};const composition=await selectComposition({serveUrl,id:'ChatVideo',inputProps});
        await renderMedia({composition,serveUrl,codec:'h264',outputLocation,inputProps});
        return json(200,{path:outputLocation});
      }
    }
    json(404,{error:'Не найдено'});
  } catch(error){json(500,{error:error instanceof Error?error.message:String(error)})}
});
server.listen(port,'127.0.0.1',()=>console.log(`ChatCinema Studio: http://127.0.0.1:${port}`));
