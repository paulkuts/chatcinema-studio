import { newId, ProjectSchema, type Project } from '../domain/project';

export type Command =
  | { type: 'project.rename'; name: string }
  | { type: 'preset.set'; preset: Project['preset'] }
  | { type: 'preset.update'; patch: Partial<Omit<Project['preset'], 'id'>> }
  | { type: 'emotion.upsert'; preset: Project['emotionPresets'][number] }
  | { type: 'group.upsert'; group: Project['groups'][number] }
  | { type: 'asset.add'; asset: Project['assets'][number] }
  | { type: 'message.lock'; id: string; locked: boolean }
  | { type: 'timeline.lock'; id: string; locked: boolean }
  | { type: 'character.add'; character: { id?: string; name: string; color: string } }
  | { type: 'message.add'; message: { id?: string; characterId: string; text: string; storyTime: string; storyDay: string; emotion: string; linkedToPrevious?: boolean; groupId?: string; soundOverride?: string } }
  | { type: 'message.update'; id: string; patch: Partial<Pick<Project['messages'][number], 'characterId' | 'text' | 'storyTime' | 'storyDay' | 'emotion' | 'linkedToPrevious' | 'groupId' | 'soundOverride'>> }
  | { type: 'message.delete'; id: string }
  | { type: 'timeline.regenerate'; defaultDurationFrames?: number }
  | { type: 'timeline.set_duration'; id: string; durationFrames: number }
  | { type: 'timeline.move'; id: string; startFrame: number }
  | { type: 'timeline.add_pause'; startFrame: number; durationFrames: number; id?: string };

export interface ScreenState { id: string; messageIds: string[] }
export interface RenderPlanItem {
  id: string; type: 'screen' | 'pause'; startFrame: number; durationFrames: number;
  messageIds: string[]; sound: string | null;
}

export class TimelineConflictError extends Error {
  constructor(message: string) { super(message); this.name = 'TimelineConflictError'; }
}

/** A screen is a contiguous message burst: linked messages or the same explicit group stay together. */
export function generateScreenStates(project: Project): ScreenState[] {
  const states: ScreenState[] = [];
  const accumulated: string[] = [];
  let previous: Project['messages'][number] | undefined;
  for (const message of project.messages) {
    const sameExplicitGroup = Boolean(message.groupId && previous?.groupId === message.groupId);
    if (!previous || (!message.linkedToPrevious && !sameExplicitGroup)) accumulated.length = 0;
    accumulated.push(message.id);
    states.push({ id: message.id, messageIds: [...accumulated] });
    previous = message;
  }
  return states;
}

function regenerate(project: Project, defaultDurationFrames = project.render.fps * 2): Project['timeline'] {
  if (!Number.isInteger(defaultDurationFrames) || defaultDurationFrames < 1) throw new RangeError('defaultDurationFrames must be a positive integer');
  const states = generateScreenStates(project);
  const stateIds = new Set(states.map((state) => state.id));
  for (const block of project.timeline) {
    if (block.type === 'screen' && block.manuallyEdited && !stateIds.has(block.screenMessageId)) {
      throw new TimelineConflictError(`Cannot regenerate: manually edited screen ${block.id} no longer exists`);
    }
  }
  const oldScreens = new Map(project.timeline.filter((b) => b.type === 'screen').map((b) => [b.screenMessageId!, b]));
  const generated = states.map((state) => {
    const existing = oldScreens.get(state.id);
    return existing ? { ...existing } : {
      id: newId(), type: 'screen' as const, screenMessageId: state.id,
      startFrame: 0, durationFrames: defaultDurationFrames, origin: 'auto' as const, manuallyEdited: false, locked: false,
    };
  });
  // Retain prior block order. New screens are appended in message order; existing manual pauses stay put.
  const ordered: Project['timeline'] = [];
  for (const block of project.timeline) {
    if (block.type === 'pause') ordered.push({ ...block });
    else {
      const match = generated.find((candidate) => candidate.type === 'screen' && candidate.screenMessageId === block.screenMessageId);
      if (match && !ordered.some((b) => b.id === match.id)) ordered.push(match);
    }
  }
  for (const block of generated) if (!ordered.some((b) => b.id === block.id)) ordered.push(block);
  let cursor = 0;
  return ordered.map((block) => {
    const positioned = { ...block, startFrame: cursor };
    cursor += block.durationFrames;
    return positioned;
  });
}

function history(project: Project, next: Project, command: Command): Project['history'] {
  let object = 'project';
  let field = 'timeline';
  let oldValue: unknown = project.timeline;
  let newValue: unknown = next.timeline;
  switch (command.type) {
    case 'preset.set': object = `preset:${command.preset.id}`; field = 'preset'; oldValue = project.preset; newValue = next.preset; break;
    case 'preset.update': object = `preset:${project.preset.id}`; field = 'preset'; oldValue = project.preset; newValue = next.preset; break;
    case 'emotion.upsert': object = `emotion:${command.preset.id}`; field = 'preset'; oldValue = project.emotionPresets.find(x => x.id === command.preset.id) ?? null; newValue = command.preset; break;
    case 'group.upsert': object = `group:${command.group.id}`; field = 'group'; oldValue = project.groups.find(x => x.id === command.group.id) ?? null; newValue = command.group; break;
    case 'asset.add': object = `asset:${command.asset.id}`; field = 'asset'; oldValue = null; newValue = command.asset; break;
    case 'message.lock': object = `message:${command.id}`; field = 'locked'; oldValue = project.messages.find(x => x.id === command.id)?.locked; newValue = command.locked; break;
    case 'timeline.lock': object = `timeline:${command.id}`; field = 'locked'; oldValue = project.timeline.find(x => x.id === command.id)?.locked; newValue = command.locked; break;
    case 'project.rename': object = `project:${project.id}`; field = 'name'; oldValue = project.name; newValue = next.name; break;
    case 'character.add': object = `character:${command.character.id ?? next.characters.at(-1)?.id}`; field = 'character'; oldValue = null; newValue = next.characters.at(-1); break;
    case 'message.add': object = `message:${command.message.id ?? next.messages.at(-1)?.id}`; field = 'message'; oldValue = null; newValue = next.messages.at(-1); break;
    case 'message.update': {
      object = `message:${command.id}`; field = Object.keys(command.patch).join(',') || 'message';
      const before = project.messages.find((m) => m.id === command.id); const after = next.messages.find((m) => m.id === command.id);
      oldValue = before ? Object.fromEntries(Object.keys(command.patch).map((key) => [key, before[key as keyof typeof before]])) : null;
      newValue = after ? Object.fromEntries(Object.keys(command.patch).map((key) => [key, after[key as keyof typeof after]])) : null; break;
    }
    case 'message.delete': object = `message:${command.id}`; field = 'message'; oldValue = project.messages.find((m) => m.id === command.id) ?? null; newValue = null; break;
    case 'timeline.set_duration': object = `timeline:${command.id}`; field = 'durationFrames'; oldValue = project.timeline.find((b) => b.id === command.id)?.durationFrames ?? null; newValue = next.timeline.find((b) => b.id === command.id)?.durationFrames ?? null; break;
    case 'timeline.move': object = `timeline:${command.id}`; field = 'startFrame'; oldValue = project.timeline.find((b) => b.id === command.id)?.startFrame ?? null; newValue = next.timeline.find((b) => b.id === command.id)?.startFrame ?? null; break;
    case 'timeline.add_pause': object = `timeline:${command.id ?? next.timeline.find((b) => b.type === 'pause' && !project.timeline.some((old) => old.id === b.id))?.id}`; field = 'pause'; oldValue = null; newValue = next.timeline.find((b) => b.type === 'pause' && !project.timeline.some((old) => old.id === b.id)) ?? null; break;
    case 'timeline.regenerate': object = 'timeline'; field = 'blocks'; oldValue = project.timeline; newValue = next.timeline; break;
  }
  return [...project.history, { id: newId(), command: command.type, timestamp: new Date().toISOString(), actor: 'user', object, field, oldValue, newValue, source: command.type === 'timeline.regenerate' ? 'automatic' : 'manual' }];
}

export function execute(projectInput: Project, command: Command, provenance: { actor: string; source: 'manual' | 'automatic'; allowLocked?: boolean } = { actor: 'user', source: command.type === 'timeline.regenerate' ? 'automatic' : 'manual' }): Project {
  const project = ProjectSchema.parse(projectInput);
  let next: Project = { ...project, characters: [...project.characters], messages: [...project.messages], timeline: project.timeline.map((block) => ({ ...block })), history: [...project.history] };
  next.emotionPresets = [...project.emotionPresets]; next.groups = [...project.groups]; next.assets = [...project.assets];
  if (provenance.source === 'automatic' && !provenance.allowLocked && (command.type === 'message.update' || command.type === 'message.delete' || command.type === 'message.lock') && project.messages.find(m => m.id === command.id)?.locked) throw new TimelineConflictError(`Message ${command.id} is locked`);
  if (provenance.source === 'automatic' && !provenance.allowLocked && command.type === 'timeline.lock' && project.timeline.find(b => b.id === command.id)?.locked) throw new TimelineConflictError(`Timeline block ${command.id} is locked`);
  let messagesChanged = false;
  switch (command.type) {
    case 'preset.set': next.preset = command.preset; break;
    case 'preset.update': next.preset = {...next.preset, ...command.patch}; break;
    case 'emotion.upsert': { const i = next.emotionPresets.findIndex(x => x.id === command.preset.id); if (i < 0) next.emotionPresets.push(command.preset); else next.emotionPresets[i] = command.preset; break; }
    case 'group.upsert': { const i = next.groups.findIndex(x => x.id === command.group.id); if (i < 0) next.groups.push(command.group); else next.groups[i] = command.group; break; }
    case 'asset.add': if (next.assets.some(x => x.id === command.asset.id)) throw new Error(`Asset already exists: ${command.asset.id}`); else { next.assets.push(command.asset); break; }
    case 'message.lock': { const i = next.messages.findIndex(x => x.id === command.id); if (i < 0) throw new Error(`Message not found: ${command.id}`); next.messages[i] = {...next.messages[i]!, locked: command.locked}; break; }
    case 'timeline.lock': { const b = next.timeline.find(x => x.id === command.id); if (!b) throw new Error(`Timeline block not found: ${command.id}`); b.locked = command.locked; break; }
    case 'project.rename': {
      if (!command.name.trim()) throw new Error('Project name cannot be empty');
      next.name = command.name;
      break;
    }
    case 'character.add': {
      const id = command.character.id ?? newId();
      if (next.characters.some((c) => c.id === id)) throw new Error(`Character already exists: ${id}`);
      next.characters.push({ ...command.character, id });
      break;
    }
    case 'message.add': {
      const id = command.message.id ?? newId();
      if (next.messages.some((m) => m.id === id)) throw new Error(`Message already exists: ${id}`);
      next.messages.push({ ...command.message, id, locked: false, linkedToPrevious: command.message.linkedToPrevious ?? false });
      messagesChanged = true;
      break;
    }
    case 'message.update': {
      const index = next.messages.findIndex((m) => m.id === command.id);
      if (index < 0) throw new Error(`Message not found: ${command.id}`);
      next.messages[index] = { ...next.messages[index]!, ...command.patch };
      messagesChanged = true;
      break;
    }
    case 'message.delete': {
      if (!next.messages.some((m) => m.id === command.id)) throw new Error(`Message not found: ${command.id}`);
      next.messages = next.messages.filter((m) => m.id !== command.id);
      messagesChanged = true;
      break;
    }
    case 'timeline.regenerate':
      next.timeline = regenerate(next, command.defaultDurationFrames);
      break;
    case 'timeline.set_duration': {
      if (!Number.isInteger(command.durationFrames) || command.durationFrames < 1) throw new RangeError('durationFrames must be a positive integer');
      const block = next.timeline.find((b) => b.id === command.id);
      if (!block) throw new Error(`Timeline block not found: ${command.id}`);
      block.durationFrames = command.durationFrames;
      block.origin = 'manual'; block.manuallyEdited = true;
      next.timeline.sort((a, b) => a.startFrame - b.startFrame);
      next.timeline = position(next.timeline);
      break;
    }
    case 'timeline.move': {
      if (!Number.isInteger(command.startFrame) || command.startFrame < 0) throw new RangeError('startFrame must be a nonnegative integer');
      const block = next.timeline.find((b) => b.id === command.id);
      if (!block) throw new Error(`Timeline block not found: ${command.id}`);
      block.startFrame = command.startFrame;
      block.origin = 'manual'; block.manuallyEdited = true;
      next.timeline.sort((a, b) => a.startFrame - b.startFrame);
      next.timeline = position(next.timeline);
      break;
    }
    case 'timeline.add_pause': {
      if (!Number.isInteger(command.startFrame) || command.startFrame < 0 || !Number.isInteger(command.durationFrames) || command.durationFrames < 1) throw new RangeError('Pause frames must be nonnegative start and positive duration');
      next.timeline.push({ id: command.id ?? newId(), type: 'pause', startFrame: command.startFrame, durationFrames: command.durationFrames, origin: 'manual', manuallyEdited: true, locked: false });
      next.timeline.sort((a, b) => a.startFrame - b.startFrame);
      next.timeline = position(next.timeline);
      break;
    }
  }
  if (messagesChanged) {
    for (const m of next.messages) {
      if (!next.emotionPresets.some(e => e.id === m.emotion)) next.emotionPresets.push({id:m.emotion,name:m.emotion,sound:null,montagePreset:'',overrides:{}});
      if (m.groupId && !next.groups.some(g => g.id === m.groupId)) next.groups.push({id:m.groupId,name:m.groupId});
    }
    next.timeline = regenerate(next);
  }
  if (!provenance.allowLocked && command.type !== 'timeline.lock') for (const block of project.timeline.filter(b => b.locked)) {
    const after = next.timeline.find(b => b.id === block.id);
    if (JSON.stringify(after) !== JSON.stringify(block)) throw new TimelineConflictError(`Timeline block ${block.id} is locked`);
  }
  next.history = history(project, next, command);
  next.history[next.history.length - 1] = {...next.history.at(-1)!, actor: provenance.actor, source: provenance.source};
  return ProjectSchema.parse(next);
}

function position(blocks: Project['timeline']): Project['timeline'] {
  let cursor = 0;
  return blocks.map((block) => {
    const positioned = { ...block, startFrame: cursor };
    cursor += block.durationFrames;
    return positioned;
  });
}

export function buildRenderPlan(projectInput: Project): RenderPlanItem[] {
  const project = ProjectSchema.parse(projectInput);
  const states = new Map(generateScreenStates(project).map((state) => [state.id, state]));
  const messageById = new Map(project.messages.map((message) => [message.id, message]));
  return project.timeline.map((block) => {
    if (block.type === 'pause') return { id: block.id, type: block.type, startFrame: block.startFrame, durationFrames: block.durationFrames, messageIds: [], sound: null };
    const state = states.get(block.screenMessageId);
    if (!state) throw new TimelineConflictError(`Timeline screen ${block.id} has no generated state`);
    const newestMessage = messageById.get(state.messageIds.at(-1)!)!;
    const sound = newestMessage.soundOverride ?? project.emotionPresets.find(p => p.id === newestMessage.emotion)?.sound ?? project.preset.messageSound;
    return { id: block.id, type: block.type, startFrame: block.startFrame, durationFrames: block.durationFrames, messageIds: [...state.messageIds], sound };
  });
}
