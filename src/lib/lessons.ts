import fs from 'fs';
import path from 'path';

// ---- Types -----------------------------------------------------------------

export type LessonTopic =
  | 'named-queries'
  | 'db-extensions'
  | 'permissions'
  | 'ps-html'
  | 'plugin-xml'
  | 'access-request'
  | 'packaging'
  | 'general';

export interface Lesson {
  id: string;
  title: string;
  topic: LessonTopic;
  content: string;
  tags: string[];
  createdAt: string;
  updatedAt: string;
}

// ---- Storage ---------------------------------------------------------------

function lessonPath(lessonsDir: string, id: string): string {
  return path.join(lessonsDir, `${id}.json`);
}

function safeId(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

// ---- CRUD ------------------------------------------------------------------

export function listLessons(lessonsDir: string): Lesson[] {
  if (!fs.existsSync(lessonsDir)) return [];
  return fs
    .readdirSync(lessonsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(lessonsDir, f), 'utf-8')) as Lesson;
      } catch {
        return null;
      }
    })
    .filter((l): l is Lesson => l !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export function getLesson(lessonsDir: string, id: string): Lesson | null {
  const fp = lessonPath(lessonsDir, id);
  if (!fs.existsSync(fp)) return null;
  try {
    return JSON.parse(fs.readFileSync(fp, 'utf-8')) as Lesson;
  } catch {
    return null;
  }
}

export function searchLessons(lessonsDir: string, query: string): Lesson[] {
  const q = query.toLowerCase();
  return listLessons(lessonsDir).filter(
    (l) =>
      l.title.toLowerCase().includes(q) ||
      l.content.toLowerCase().includes(q) ||
      l.topic.toLowerCase().includes(q) ||
      l.tags.some((t) => t.toLowerCase().includes(q)),
  );
}

export interface UpsertLessonInput {
  id?: string;
  title: string;
  topic: LessonTopic;
  content: string;
  tags: string[];
}

export function upsertLesson(
  lessonsDir: string,
  input: UpsertLessonInput,
): { lesson: Lesson; created: boolean } {
  fs.mkdirSync(lessonsDir, { recursive: true });

  const id = input.id ?? safeId(input.title);
  const now = new Date().toISOString();
  const existing = getLesson(lessonsDir, id);

  const lesson: Lesson = {
    id,
    title: input.title,
    topic: input.topic,
    content: input.content,
    tags: input.tags,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  fs.writeFileSync(lessonPath(lessonsDir, id), JSON.stringify(lesson, null, 2), 'utf-8');
  return { lesson, created: !existing };
}

export function deleteLesson(lessonsDir: string, id: string): boolean {
  const fp = lessonPath(lessonsDir, id);
  if (!fs.existsSync(fp)) return false;
  fs.unlinkSync(fp);
  return true;
}
