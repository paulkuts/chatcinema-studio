import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile } from 'remotion';
import type { Project } from '../domain/project';
import type { RenderPlanItem } from '../application/commands';
export type VideoProps = { project: Project; plan: RenderPlanItem[] };
export const ChatVideo: React.FC<VideoProps> = ({project, plan}) => <AbsoluteFill style={{background:project.preset.background,color:project.preset.textColor,fontFamily:project.preset.font}}>
  {plan.map(item => <Sequence key={item.id} from={item.startFrame} durationInFrames={item.durationFrames}>
    {item.type === 'screen' && <AbsoluteFill style={{padding:'100px 55px',justifyContent:'center',gap:24}}>{item.messageIds.map((id,i) => {const m=project.messages.find(x=>x.id===id)!; const c=project.characters.find(x=>x.id===m.characterId)!; return <div key={id} style={{alignSelf:project.characters.findIndex(x=>x.id===m.characterId)%2?'flex-end':'flex-start',maxWidth:'85%',background:project.characters.findIndex(x=>x.id===m.characterId)%2?project.preset.outgoingColor:project.preset.incomingColor,borderRadius:30,padding:'24px 32px',fontSize:44}}><div style={{fontSize:24,color:c.color,fontWeight:700}}>{c.name}</div>{m.text}<div style={{fontSize:20,textAlign:'right',opacity:.6}}>{m.storyTime}</div></div>})}</AbsoluteFill>}
    {item.sound && ['message','dramatic'].includes(item.sound) && <Audio src={staticFile(`sfx/${item.sound}.wav`)} />}
  </Sequence>)}
</AbsoluteFill>;

