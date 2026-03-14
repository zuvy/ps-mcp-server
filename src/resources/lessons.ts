import { McpServer, ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';
import { listLessons, getLesson } from '../lib/lessons.js';

export function registerLessonResources(server: McpServer, lessonsDir: string): void {
  // ---- ps://lessons/list ----------------------------------------------------

  server.resource(
    'lessons-list',
    'ps://lessons/list',
    { mimeType: 'application/json' },
    async () => {
      const lessons = listLessons(lessonsDir);
      const index = lessons.map((l) => ({
        id: l.id,
        title: l.title,
        topic: l.topic,
        tags: l.tags,
        updatedAt: l.updatedAt,
        uri: `ps://lessons/${l.id}`,
      }));

      return {
        contents: [
          {
            uri: 'ps://lessons/list',
            mimeType: 'application/json',
            text: JSON.stringify({ total: index.length, lessons: index }, null, 2),
          },
        ],
      };
    },
  );

  // ---- ps://lessons/{id} ----------------------------------------------------

  server.resource(
    'lesson-by-id',
    new ResourceTemplate('ps://lessons/{id}', {
      list: async () => {
        const lessons = listLessons(lessonsDir);
        return {
          resources: lessons.map((l) => ({
            uri: `ps://lessons/${l.id}`,
            name: l.title,
            description: `[${l.topic}] ${l.tags.join(', ')}`,
            mimeType: 'application/json',
          })),
        };
      },
    }),
    { mimeType: 'application/json' },
    async (uri, { id }) => {
      const lesson = getLesson(lessonsDir, String(id));
      if (!lesson) {
        return {
          contents: [
            {
              uri: uri.href,
              mimeType: 'application/json',
              text: JSON.stringify({ error: `No lesson found with id "${id}"` }),
            },
          ],
        };
      }

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: 'application/json',
            text: JSON.stringify(lesson, null, 2),
          },
        ],
      };
    },
  );
}
