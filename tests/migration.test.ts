import { describe, it, expect } from 'vitest';
import { mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { createProject, migrateProject } from '../src/domain/project';
import { execute, generateScreenStates, buildRenderPlan } from '../src/application/commands';
import { loadProject, saveProject } from '../src/infrastructure/storage';

function legacy() {
  return {schemaVersion:1,id:'legacy-film',name:'Film',preset:{name:'Classic',background:'#fff',textColor:'#000',incomingColor:'#eee',outgoingColor:'#afa',font:'Arial',messageSound:'message'},characters:[{id:'c',name:'C',color:'#000'}],messages:[
    {id:'m1',characterId:'c',text:'one',storyTime:'08:00',storyDay:'1',emotion:'neutral',linkedToPrevious:false,groupId:'g'},
    {id:'m2',characterId:'c',text:'two',storyTime:'08:01',storyDay:'1',emotion:'dramatic',linkedToPrevious:true,groupId:'g'},
    {id:'m3',characterId:'c',text:'three',storyTime:'08:02',storyDay:'1',emotion:'neutral',linkedToPrevious:true,groupId:'g'},
  ], timeline:[{id:'b1',type:'screen',screenMessageId:'m1',startFrame:7,durationFrames:41,origin:'manual',manuallyEdited:true},{id:'b2',type:'screen',screenMessageId:'m2',startFrame:48,durationFrames:62,origin:'auto',manuallyEdited:false},{id:'b3',type:'screen',screenMessageId:'m3',startFrame:110,durationFrames:22,origin:'auto',manuallyEdited:false}],render:{fps:30,width:1080,height:1920},history:[]};
}
describe('schema migration', () => {
  it('loads v1 deterministically without writing, preserves links, timing and survives save/reopen', async () => {
    const root = join(process.cwd(),'.tmp','migration-p11-test'); const file = join(root,'legacy-film','project.json');
    await mkdir(join(root,'legacy-film'),{recursive:true}); const text=JSON.stringify(legacy()); await writeFile(file,text);
    try {
      const p = await loadProject(root,'legacy-film'); expect(await readFile(file,'utf8')).toBe(text);
      expect(p).toEqual(migrateProject(legacy())); expect(p.schemaVersion).toBe(2);
      expect(p.messages.map(m=>m.id)).toEqual(['m1','m2','m3']);
      expect(p.timeline.map(({startFrame,durationFrames})=>[startFrame,durationFrames])).toEqual([[7,41],[48,62],[110,22]]);
      expect(generateScreenStates(p).map(s=>s.messageIds)).toEqual([['m1'],['m1','m2'],['m1','m2','m3']]);
      expect(buildRenderPlan(p).map(x=>x.sound)).toEqual(['message','dramatic','message']);
      await saveProject(root,p); expect(await loadProject(root,p.id)).toEqual(p);
    } finally { await rm(root,{recursive:true,force:true}); }
  });
  it('rejects unknown fields and unsupported versions instead of discarding data', () => {
    expect(()=>migrateProject({...legacy(),extra:1})).toThrow(/migration.*version 1/i);
    expect(()=>migrateProject({...legacy(),preset:{...legacy().preset,extra:1}})).toThrow(/extra/);
    expect(()=>migrateProject({...legacy(),schemaVersion:99})).toThrow(/unsupported schemaVersion 99/);
  });
});
describe('new domain entities and locks', () => {
  it('creates and edits presets and groups, records provenance and stores a relative asset', () => {
    let p=createProject('Film');
    p=execute(p,{type:'preset.set',preset:{...p.preset,id:'custom',name:'Custom'}});
    p=execute(p,{type:'preset.update',patch:{name:'Edited',messageStyle:{borderRadius:12}}});
    p=execute(p,{type:'emotion.upsert',preset:{id:'joy',name:'Joy',sound:'message',montagePreset:'cut',overrides:{strength:2}}});
    p=execute(p,{type:'emotion.upsert',preset:{...p.emotionPresets.find(e=>e.id==='joy')!,name:'Happy'}});
    p=execute(p,{type:'asset.add',asset:{id:'a',name:'Audio',type:'audio',relativePath:'media/a.wav',mimeType:'audio/wav',tags:[],description:'',source:'',rights:'UNKNOWN',scope:'project'}});
    p=execute(p,{type:'group.upsert',group:{id:'g',name:'Group'}});
    p=execute(p,{type:'group.upsert',group:{id:'g',name:'Edited group'}});
    expect(p.preset).toMatchObject({id:'custom',name:'Edited'}); expect(p.emotionPresets.find(x=>x.id==='joy')?.name).toBe('Happy');
    expect(p.groups[0]?.name).toBe('Edited group'); expect(p.assets[0]?.rights).toBe('UNKNOWN');
    expect(p.history.at(-1)).toMatchObject({actor:'user',source:'manual',object:'group:g'});
    expect(()=>execute(p,{type:'asset.add',asset:{...p.assets[0]!,id:'bad',relativePath:'../a'}})).toThrow();
  });
  it('assigns an explicit group without reordering or changing story time', () => {
    let p = createProject('Group'); p=execute(p,{type:'character.add',character:{id:'c',name:'C',color:'#000'}});
    for (const id of ['a','b','c']) p=execute(p,{type:'message.add',message:{id,characterId:'c',text:id,storyTime:id,storyDay:'1',emotion:'neutral'}});
    p=execute(p,{type:'group.upsert',group:{id:'g',name:'Group'}});
    for (const id of ['a','b','c']) p=execute(p,{type:'message.update',id,patch:{groupId:'g'}});
    expect(p.messages.map(m=>[m.id,m.storyTime])).toEqual([['a','a'],['b','b'],['c','c']]);
    expect(generateScreenStates(p).map(s=>s.messageIds)).toEqual([['a'],['a','b'],['a','b','c']]);
    expect(buildRenderPlan(p).map(x=>x.sound)).toEqual(['message','message','message']);
  });
  it('retains locks and rejects direct and indirect automatic changes atomically', () => {
    let p=migrateProject(legacy()); p=execute(p,{type:'message.lock',id:'m1',locked:true}); p=execute(p,{type:'timeline.lock',id:'b2',locked:true});
    expect(migrateProject(JSON.parse(JSON.stringify(p))).messages[0]?.locked).toBe(true);
    expect(()=>execute(p,{type:'message.update',id:'m1',patch:{text:'AI'}},{actor:'ai',source:'automatic'})).toThrow(/locked/);
    expect(()=>execute(p,{type:'timeline.regenerate'})).toThrow(/locked/);
    expect(()=>execute(p,{type:'timeline.lock',id:'b2',locked:false},{actor:'ai',source:'automatic'})).toThrow(/locked/);
    expect(p.messages[0]?.text).toBe('one'); expect(p.timeline[1]?.startFrame).toBe(48);
  });
});
