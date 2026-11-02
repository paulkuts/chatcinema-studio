import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createProject } from '../src/domain/project.js';
import { listProjects, loadProject, saveProject } from '../src/infrastructure/storage.js';
import { execute } from '../src/application/commands.js';

const temporaryRoots: string[] = [];

async function createRoot(): Promise<string> {
  await mkdir(join(process.cwd(), '.tmp'), {recursive:true});
  const root = await mkdtemp(join(process.cwd(), '.tmp', 'chatcinema-storage-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('project storage', () => {
  it('saves and reloads a project without losing manually supplied values', async () => {
    const root = await createRoot();
    const project = {
      ...createProject('My short film'),
      id: 'film_2026-01',
      characters: [{ id: 'hero', name: 'Mira', color: '#123456' }],
      messages: [{
        id: 'message-1', characterId: 'hero', text: 'Keep this wording', storyTime: '08:15', storyDay: 'Friday',
        emotion: 'calm', linkedToPrevious: false,
      }],
    };

    await saveProject(root, project);

    await expect(loadProject(root, project.id)).resolves.toEqual(project);
    await expect(listProjects(root)).resolves.toEqual([{ id: project.id, name: project.name }]);
  });

  it('rejects non-portable project IDs', async () => {
    const root = await createRoot();
    const project = { ...createProject('Invalid'), id: '../escape' };

    await expect(saveProject(root, project)).rejects.toThrow(/Invalid project ID/);
    await expect(loadProject(root, 'CON')).rejects.toThrow(/Invalid project ID/);
  });

  it('retains manually edited timeline blocks after reopening and regenerating', async () => {
    const root = await createRoot();
    let project = createProject('Timeline');
    project = execute(project, {type:'character.add', character:{id:'hero',name:'Hero',color:'#123456'}});
    project = execute(project, {type:'message.add', message:{id:'m1',characterId:'hero',text:'Hello',storyTime:'08:00',storyDay:'1',emotion:'neutral'}});
    project = execute(project, {type:'timeline.set_duration', id:project.timeline[0]!.id, durationFrames:83});
    project = execute(project, {type:'timeline.add_pause',startFrame:83,durationFrames:21});
    await saveProject(root, project);
    const loaded = await loadProject(root, project.id);
    const regenerated = execute(loaded, {type:'timeline.regenerate'});
    expect(regenerated.timeline.map(b=>b.durationFrames)).toEqual([83,21]);
    expect(regenerated.timeline.map(b=>b.startFrame)).toEqual([0,83]);
    await saveProject(root, regenerated);
    expect((await loadProject(root, project.id)).timeline).toEqual(regenerated.timeline);
  });

  it('rejects invalid documents and keeps a previously saved version intact', async () => {
    const root = await createRoot();
    const project = createProject('Valid version');
    await saveProject(root, project);

    await expect(saveProject(root, { ...project, name: '' })).rejects.toThrow();
    await expect(loadProject(root, project.id)).resolves.toEqual(project);
  });
});
