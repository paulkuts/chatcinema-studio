import React from 'react';
import {Composition, registerRoot} from 'remotion';
import {ChatVideo, type VideoProps} from './ChatVideo';
import {createProject} from '../domain/project';
const project=createProject('Default');
const Root=()=> <Composition id="ChatVideo" component={ChatVideo} durationInFrames={1} fps={30} width={1080} height={1920} defaultProps={{project,plan:[]} satisfies VideoProps} calculateMetadata={({props})=>({durationInFrames:Math.max(1,...props.plan.map(x=>x.startFrame+x.durationFrames)),fps:props.project.render.fps,width:props.project.render.width,height:props.project.render.height})} />;
registerRoot(Root);
