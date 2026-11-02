import { describe, expect, it } from 'vitest';
import { createProject } from '../src/domain/project';
import { buildRenderPlan, execute, generateScreenStates, TimelineConflictError } from '../src/application/commands';

function withCharacter() {
  let project = createProject('Test');
  project = execute(project, { type: 'character.add', character: { id: 'c1', name: 'Alex', color: '#f00' } });
  return project;
}
function addMessage(project: ReturnType<typeof createProject>, id: string, extras: Partial<{ linkedToPrevious: boolean; emotion: string; soundOverride: string; groupId: string }> = {}) {
  return execute(project, { type: 'message.add', message: { id, characterId: 'c1', text: id, storyTime: '12:00', storyDay: 'Monday', emotion: extras.emotion ?? 'neutral', ...extras } });
}

describe('project domain and application commands', () => {
  it('creates a schema-valid project with defaults and UUID', () => {
    const project = createProject('Film');
    expect(project.schemaVersion).toBe(2);
    expect(project.id).toMatch(/^[0-9a-f-]{36}$/i);
    expect(project.render).toEqual({ fps: 30, width: 1080, height: 1920 });
  });

  it('renames a project through a command and records the old and new names', () => {
    const before = createProject('Old');
    const after = execute(before, { type: 'project.rename', name: 'New' });
    expect(before.name).toBe('Old');
    expect(after.name).toBe('New');
    expect(after.history.at(-1)).toMatchObject({ command: 'project.rename', field: 'name', oldValue: 'Old', newValue: 'New', source: 'manual' });
  });

  it('records history and regenerates screen states for message mutations', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    project = addMessage(project, 'm2', { linkedToPrevious: true });
    project = addMessage(project, 'm3');
    expect(project.history).toHaveLength(4);
    expect(generateScreenStates(project).map((s) => s.messageIds)).toEqual([['m1'], ['m1', 'm2'], ['m3']]);
    expect(generateScreenStates(project).map((s) => s.id)).toEqual(['m1', 'm2', 'm3']);
    expect(project.history.every((entry) => entry.actor && entry.object && entry.field && 'oldValue' in entry && 'newValue' in entry && entry.source)).toBe(true);
    project = execute(project, { type: 'message.update', id: 'm3', patch: { text: 'changed' } });
    expect(project.history.at(-1)?.command).toBe('message.update');
    project = execute(project, { type: 'message.delete', id: 'm3' });
    expect(project.timeline).toHaveLength(2);
  });

  it('starts a fresh screen accumulation at unrelated messages and continues linked or grouped runs', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    project = addMessage(project, 'm2', { linkedToPrevious: true, groupId: 'g' });
    project = addMessage(project, 'm3', { groupId: 'g' });
    project = addMessage(project, 'm4');
    expect(generateScreenStates(project).map((state) => state.messageIds)).toEqual([
      ['m1'], ['m1', 'm2'], ['m1', 'm2', 'm3'], ['m4'],
    ]);
  });

  it('keeps story time independent of timeline frames', () => {
    let project = addMessage(withCharacter(), 'm1');
    const before = buildRenderPlan(project);
    project = execute(project, {type:'message.update', id:'m1', patch:{storyTime:'23:59', storyDay:'42'}});
    expect(buildRenderPlan(project)).toEqual(before);
  });

  it('preserves manually changed duration and existing block order on regeneration', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    project = addMessage(project, 'm2');
    const [first, second] = project.timeline;
    project = execute(project, { type: 'timeline.set_duration', id: second!.id, durationFrames: 77 });
    project = execute(project, { type: 'timeline.move', id: first!.id, startFrame: 200 });
    expect(project.timeline.map((b) => b.type === 'screen' ? b.screenMessageId : '')).toEqual(['m2', 'm1']);
    project = execute(project, { type: 'timeline.regenerate' });
    expect(project.timeline[0]?.type === 'screen' ? project.timeline[0].screenMessageId : '').toBe('m2');
    expect(project.timeline.find((b) => b.id === second!.id)?.durationFrames).toBe(77);
    expect(project.timeline.find((b) => b.id === second!.id)?.manuallyEdited).toBe(true);
    expect(project.history.at(-1)?.command).toBe('timeline.regenerate');
    expect(project.history.at(-1)?.source).toBe('automatic');
    project.timeline.forEach((block, i) => {
      if (i > 0) expect(block.startFrame).toBe(project.timeline[i - 1]!.startFrame + project.timeline[i - 1]!.durationFrames);
    });
    expect(first).toBeDefined();
  });

  it('does not mutate input blocks when setting duration or moving', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    const input = project;
    const before = structuredClone(input.timeline);
    const id = input.timeline[0]!.id;
    const changed = execute(input, { type: 'timeline.set_duration', id, durationFrames: 91 });
    expect(input.timeline).toEqual(before);
    expect(changed.timeline[0]?.durationFrames).toBe(91);
    const moved = execute(input, { type: 'timeline.move', id, startFrame: 27 });
    expect(input.timeline).toEqual(before);
    expect(moved.timeline[0]?.startFrame).toBe(0);
  });

  it('throws a conflict if a message deletion removes a manually edited screen', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    project = execute(project, { type: 'timeline.set_duration', id: project.timeline[0]!.id, durationFrames: 80 });
    expect(() => execute(project, { type: 'message.delete', id: 'm1' })).toThrow(TimelineConflictError);
  });

  it('adds a manual pause and builds message IDs with sound only for each new message group', () => {
    let project = withCharacter();
    project = addMessage(project, 'm1');
    project = addMessage(project, 'm2', { linkedToPrevious: true, emotion: 'dramatic' });
    project = addMessage(project, 'm3', { soundOverride: 'custom-sound' });
    project = execute(project, { type: 'timeline.add_pause', startFrame: project.timeline.at(-1)!.startFrame + project.timeline.at(-1)!.durationFrames, durationFrames: 9 });
    const plan = buildRenderPlan(project);
    expect(plan[0]).toMatchObject({ type: 'screen', messageIds: ['m1'], sound: 'message' });
    expect(plan[1]).toMatchObject({ type: 'screen', messageIds: ['m1', 'm2'], sound: 'dramatic' });
    expect(plan[2]).toMatchObject({ type: 'screen', messageIds: ['m3'], sound: 'custom-sound' });
    expect(plan[3]).toMatchObject({ type: 'pause', messageIds: [], sound: null, durationFrames: 9 });
  });
});
