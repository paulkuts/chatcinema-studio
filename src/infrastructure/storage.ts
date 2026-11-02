import { randomUUID } from 'node:crypto';
import { mkdir, open, readFile, readdir, rename, unlink } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { ProjectSchema, type Project } from '../domain/project.js';

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const RESERVED_WINDOWS_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i;

function assertProjectId(id: string): void {
  if (
    !ID_PATTERN.test(id) ||
    id === '.' ||
    id === '..' ||
    id.endsWith('.') ||
    RESERVED_WINDOWS_NAME.test(id)
  ) {
    throw new Error(`Invalid project ID: ${JSON.stringify(id)}`);
  }
}

function parseProject(text: string): Project {
  return ProjectSchema.parse(JSON.parse(text) as unknown);
}

export async function saveProject(root: string, project: Project): Promise<void> {
  const validated = ProjectSchema.parse(project);
  assertProjectId(validated.id);

  const directory = join(resolve(root), validated.id);
  const destination = join(directory, 'project.json');
  const temporary = join(directory, `.project.${randomUUID()}.tmp`);
  await mkdir(directory, { recursive: true });

  let temporaryCreated = false;
  try {
    const handle = await open(temporary, 'wx');
    temporaryCreated = true;
    try {
      await handle.writeFile(`${JSON.stringify(validated, null, 2)}\n`, 'utf8');
      await handle.sync();
    } finally {
      await handle.close();
    }
    await rename(temporary, destination);
    temporaryCreated = false;
  } finally {
    if (temporaryCreated) {
      await unlink(temporary).catch(() => undefined);
    }
  }
}

export async function loadProject(root: string, id: string): Promise<Project> {
  assertProjectId(id);
  const file = join(resolve(root), id, 'project.json');
  const project = parseProject(await readFile(file, 'utf8'));
  if (project.id !== id) {
    throw new Error(`Project ID mismatch: expected ${JSON.stringify(id)}, found ${JSON.stringify(project.id)}`);
  }
  return project;
}

export async function listProjects(root: string): Promise<{ id: string; name: string }[]> {
  const entries = await readdir(resolve(root), { withFileTypes: true });
  const projects: { id: string; name: string }[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    try {
      assertProjectId(entry.name);
      const project = parseProject(await readFile(join(resolve(root), entry.name, 'project.json'), 'utf8'));
      if (project.id === entry.name) projects.push({ id: project.id, name: project.name });
    } catch {
      // Ignore unrelated directories and invalid or incomplete project records.
    }
  }

  return projects.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
}
