import { z } from 'zod';

const LegacyPresetSchema = z.object({
  name: z.string().min(1), background: z.string().min(1), textColor: z.string().min(1),
  incomingColor: z.string().min(1), outgoingColor: z.string().min(1), font: z.string().min(1), messageSound: z.string().min(1),
}).strict();
const CharacterSchema = z.object({ id: z.string().min(1), name: z.string().min(1), color: z.string().min(1) }).strict();
const LegacyMessageSchema = z.object({
  id: z.string().min(1), characterId: z.string().min(1), text: z.string(), storyTime: z.string(), storyDay: z.string(),
  emotion: z.string().min(1), linkedToPrevious: z.boolean(), groupId: z.string().optional(), soundOverride: z.string().optional(),
}).strict();
const LegacyTimelineBlockSchema = z.discriminatedUnion('type', [
  z.object({ id: z.string().min(1), type: z.literal('screen'), screenMessageId: z.string().min(1), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive(), origin: z.enum(['auto', 'manual']), manuallyEdited: z.boolean() }).strict(),
  z.object({ id: z.string().min(1), type: z.literal('pause'), startFrame: z.number().int().nonnegative(), durationFrames: z.number().int().positive(), origin: z.enum(['auto', 'manual']), manuallyEdited: z.boolean() }).strict(),
]);
const HistoryEntrySchema = z.object({
  id: z.string(), command: z.string(), timestamp: z.string(), actor: z.string(), object: z.string(), field: z.string(),
  oldValue: z.unknown(), newValue: z.unknown(), source: z.string(),
}).strict();

const LegacyProjectSchema = z.object({
  schemaVersion: z.literal(1), id: z.string().min(1), name: z.string().min(1), preset: LegacyPresetSchema,
  characters: z.array(CharacterSchema), messages: z.array(LegacyMessageSchema), timeline: z.array(LegacyTimelineBlockSchema),
  render: z.object({ fps: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(),
  history: z.array(HistoryEntrySchema),
}).strict().superRefine((project, ctx) => {
  const characterIds = new Set(project.characters.map((c) => c.id));
  project.messages.forEach((m, i) => { if (!characterIds.has(m.characterId)) ctx.addIssue({ code: 'custom', path: ['messages', i, 'characterId'], message: `Unknown character: ${m.characterId}` }); });
  const messageIds = new Set(project.messages.map((m) => m.id));
  project.timeline.forEach((b, i) => { if (b.type === 'screen' && !messageIds.has(b.screenMessageId)) ctx.addIssue({ code: 'custom', path: ['timeline', i, 'screenMessageId'], message: `Unknown message: ${b.screenMessageId}` }); });
});

const ChatPresetSchema = LegacyPresetSchema.extend({ id: z.string().min(1), messageStyle: z.object({ borderRadius: z.number().nonnegative() }).strict(), characterDisplay: z.object({ showName: z.boolean() }).strict() }).strict();
const EmotionPresetSchema = z.object({ id: z.string().min(1), name: z.string().min(1), sound: z.string().nullable(), montagePreset: z.string(), overrides: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])) }).strict();
const AssetSchema = z.object({ id: z.string().min(1), name: z.string().min(1), type: z.enum(['audio', 'video', 'image', 'gif']), relativePath: z.string().min(1).refine(p => !/^(?:[a-z]:|[\\/])|(?:^|[\\/])\.\.(?:[\\/]|$)/i.test(p), 'Asset path must be relative and stay within its root'), mimeType: z.string().min(1), tags: z.array(z.string()), description: z.string(), source: z.string(), rights: z.enum(['UNKNOWN', 'LICENSED', 'PUBLIC_DOMAIN', 'OWNED']), scope: z.enum(['application', 'project']) }).strict();
const MessageSchema = LegacyMessageSchema.extend({ locked: z.boolean().default(false) }).strict();
const TimelineBlockSchema = z.discriminatedUnion('type', [
  LegacyTimelineBlockSchema.options[0].extend({ locked: z.boolean().default(false) }).strict(),
  LegacyTimelineBlockSchema.options[1].extend({ locked: z.boolean().default(false) }).strict(),
]);
const GroupSchema = z.object({ id: z.string().min(1), name: z.string().min(1) }).strict();
export const ProjectSchema = z.object({
  schemaVersion: z.literal(2), id: z.string().min(1), name: z.string().min(1), preset: ChatPresetSchema,
  emotionPresets: z.array(EmotionPresetSchema), assets: z.array(AssetSchema), groups: z.array(GroupSchema),
  characters: z.array(CharacterSchema), messages: z.array(MessageSchema), timeline: z.array(TimelineBlockSchema),
  render: z.object({ fps: z.number().int().positive(), width: z.number().int().positive(), height: z.number().int().positive() }).strict(), history: z.array(HistoryEntrySchema),
}).strict().superRefine((project, ctx) => {
  const ids = (items: { id: string }[], path: string) => { const seen = new Set<string>(); items.forEach((item, i) => { if (seen.has(item.id)) ctx.addIssue({code:'custom', path:[path,i,'id'], message:`Duplicate ID: ${item.id}`}); seen.add(item.id); }); };
  for (const key of ['characters','messages','timeline','emotionPresets','assets','groups'] as const) ids(project[key], key);
  const characters = new Set(project.characters.map(c => c.id));
  const messages = new Set(project.messages.map(m => m.id));
  const emotions = new Set(project.emotionPresets.map(e => e.id)); const groups = new Set(project.groups.map(g => g.id));
  project.messages.forEach((m,i) => { if (!characters.has(m.characterId)) ctx.addIssue({code:'custom',path:['messages',i,'characterId'],message:`Unknown character: ${m.characterId}`}); if (!emotions.has(m.emotion)) ctx.addIssue({code:'custom',path:['messages',i,'emotion'],message:`Unknown emotion: ${m.emotion}`}); if (m.groupId && !groups.has(m.groupId)) ctx.addIssue({code:'custom',path:['messages',i,'groupId'],message:`Unknown group: ${m.groupId}`}); });
  project.timeline.forEach((b,i) => { if (b.type === 'screen' && !messages.has(b.screenMessageId)) ctx.addIssue({code:'custom',path:['timeline',i,'screenMessageId'],message:`Unknown message: ${b.screenMessageId}`}); });
});
export type Project = z.infer<typeof ProjectSchema>;
export const newId = (): string => globalThis.crypto.randomUUID();
const emotionPreset = (id: string) => ({ id, name: id, sound: id === 'dramatic' ? 'dramatic' : null, montagePreset: '', overrides: {} });

/** Reject unknown legacy fields rather than silently discarding data. Loading never writes to disk. */
export function migrateProject(input: unknown): Project {
  if (!input || typeof input !== 'object' || !('schemaVersion' in input)) throw new Error('Project migration: missing schemaVersion');
  const version = input.schemaVersion;
  if (version === 2) return ProjectSchema.parse(input);
  if (version !== 1) throw new Error(`Project migration: unsupported schemaVersion ${String(version)}`);
  const parsed = LegacyProjectSchema.safeParse(input);
  if (!parsed.success) throw new Error(`Project migration from version 1 failed: ${parsed.error.message}`);
  const old = parsed.data;
  const emotions = [...new Set(['neutral', 'dramatic', ...old.messages.map(m => m.emotion)])];
  const groups = [...new Set(old.messages.flatMap(m => m.groupId ? [m.groupId] : []))];
  return ProjectSchema.parse({ ...old, schemaVersion: 2,
    preset: { ...old.preset, id: `chat:${old.id}`, messageStyle: {borderRadius:30}, characterDisplay: {showName:true} },
    emotionPresets: emotions.map(emotionPreset), assets: [], groups: groups.map(id => ({id,name:id})),
    messages: old.messages.map(m => ({...m,locked:false})), timeline: old.timeline.map(b => ({...b,locked:false})),
  });
}
export function createProject(name: string): Project {
  return ProjectSchema.parse({ schemaVersion: 2, id: newId(), name, preset: {
    id: newId(), name: 'Classic', background: '#ffffff', textColor: '#171717', incomingColor: '#eeeeee', outgoingColor: '#b9f6ca', font: 'Arial', messageSound: 'message', messageStyle:{borderRadius:30}, characterDisplay:{showName:true},
  }, emotionPresets: ['neutral','dramatic','calm'].map(emotionPreset), assets: [], groups: [], characters: [], messages: [], timeline: [], render: {fps:30,width:1080,height:1920}, history: [] });
}
