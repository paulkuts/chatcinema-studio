import { z } from 'zod';

const PresetSchema = z.object({
  name: z.string().min(1), background: z.string().min(1), textColor: z.string().min(1),
  incomingColor: z.string().min(1), outgoingColor: z.string().min(1), font: z.string().min(1), messageSound: z.string().min(1),
}).strict();
const CharacterSchema = z.object({ id: z.string().min(1), name: z.string().min(1), color: z.string().min(1) }).strict();
const MessageSchema = z.object({
  id: z.string().min(1), characterId: z.string().min(1), text: z.string(), storyTime: z.string(), storyDay: z.string(),
  emotion: z.string().min(1), linkedToPrevious: z.boolean(), groupId: z.string().optional(), soundOverride: z.string().optional(),
}).strict();
const TimelineBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('screen'), screenMessageId: z.string().min(1), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive(), origin: z.enum(['auto', 'manual']), manuallyEdited: z.boolean() }).strict(),
  z.object({ id: z.string().min(1), type: z.literal('pause'), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive(), origin: z.enum(['auto', 'manual']), manuallyEdited: z.boolean() }).strict(),
]);
const HistoryEntrySchema = z.object({
  id: z.string(), command: z.string(), timestamp: z.string(), actor: z.string(), object: z.string(), field: z.string(),
  oldValue: z.unknown(), newValue: z.unknown(), source: z.string(),
}).strict();

export const ProjectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), preset: PresetSchema,
  characters: z.array(CharacterSchema), messages: z.array(MessageSchema), timeline: z.array(TimelineBlockSchema),
  render: z.object({ fps: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  history: z.array(HistoryEntrySchema),
}).strict().superRefine((project, ctx) => {
  const characterIds = new Set(project.characters.map((c) => c.id));
  project.messages.forEach((m, i) => { if (!characterIds.has(m.characterId)) ctx.addIssue({ code: 'custom', path: ['messages', i, 'characterId'], message: `Unknown character: ${m.characterId}` }); });
  const messageIds = new Set(project.messages.map((m) => m.id));
  project.timeline.forEach((b, i) => { if (b.type === 'screen' && !messageIds.has(b.screenMessageId)) ctx.addIssue({ code: 'custom', path: ['timeline', i, 'screenMessageId'], message: `Unknown message: ${b.screenMessageId}` }); });
});

export type Project = z.infer<typeof ProjectSchema>;
export const newId = (): string => globalThis.crypto.randomUUID();

export function createProject(name: string): Project {
  return ProjectSchema.parse({
    schemaVersion: 1, id: newId(), name, preset: {
      name: 'Classic', background: '#ffffff', textColor: '#171717', incomingColor: '#eeeeee', outgoingColor: '#b9f6ca', font: 'Arial', messageSound: 'message',
    }, characters: [], messages: [], timeline: [], render: { fps: 30, width: 1080, height: 1920 }, history: [],
  });
}
