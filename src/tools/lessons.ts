import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import {
  listLessons,
  searchLessons,
  getLesson,
  upsertLesson,
  deleteLesson,
  LessonTopic,
} from '../lib/lessons.js';

const TOPIC_VALUES = [
  'named-queries',
  'db-extensions',
  'permissions',
  'ps-html',
  'plugin-xml',
  'access-request',
  'packaging',
  'general',
] as const;

export function registerLessonTools(server: McpServer, lessonsDir: string): void {
  // ---- record_lesson --------------------------------------------------------

  server.tool(
    'record_lesson',
    'Save a lesson learned, coding pattern, gotcha, or solution to a challenge encountered while building PowerSchool plugins. Lessons persist across sessions and are surfaced via ps://lessons/* resources. Use this to capture non-obvious behavior, workarounds, and hard-won insights.',
    {
      title: z
        .string()
        .describe('Short, descriptive title for the lesson — e.g. "tlist_child requires 3-part table path"'),
      topic: z
        .enum(TOPIC_VALUES)
        .describe(
          'Category: named-queries | db-extensions | permissions | ps-html | plugin-xml | access-request | packaging | general',
        ),
      content: z
        .string()
        .describe(
          'Full lesson content in Markdown. Include: what the problem/pattern is, why it behaves this way, how to handle it, and a concrete example where helpful.',
        ),
      tags: z
        .array(z.string())
        .default([])
        .describe('Searchable tags, e.g. ["tlist", "one-to-many", "coreTable"]'),
      id: z
        .string()
        .optional()
        .describe(
          'Optional explicit slug ID (e.g. "tlist-child-3-part-path"). If omitted, derived from title. Providing the same ID as an existing lesson updates it in place.',
        ),
    },
    async ({ title, topic, content, tags, id }) => {
      const { lesson, created } = upsertLesson(lessonsDir, {
        id,
        title,
        topic: topic as LessonTopic,
        content,
        tags,
      });

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(
              {
                success: true,
                action: created ? 'created' : 'updated',
                id: lesson.id,
                title: lesson.title,
                topic: lesson.topic,
                updatedAt: lesson.updatedAt,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );

  // ---- list_lessons ---------------------------------------------------------

  server.tool(
    'list_lessons',
    'List or search saved lessons learned about PowerSchool plugin development. Returns lesson summaries (no full content). Use get_lesson to read the full content of a specific lesson.',
    {
      query: z
        .string()
        .optional()
        .describe('Optional search string — matches against title, content, topic, and tags'),
      topic: z
        .enum(TOPIC_VALUES)
        .optional()
        .describe('Filter to a specific topic category'),
    },
    async ({ query, topic }) => {
      let lessons = query ? searchLessons(lessonsDir, query) : listLessons(lessonsDir);

      if (topic) {
        lessons = lessons.filter((l) => l.topic === topic);
      }

      const summaries = lessons.map((l) => ({
        id: l.id,
        title: l.title,
        topic: l.topic,
        tags: l.tags,
        updatedAt: l.updatedAt,
        excerpt: l.content.split('\n').find((line) => line.trim()) ?? '',
      }));

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ total: summaries.length, lessons: summaries }, null, 2),
          },
        ],
      };
    },
  );

  // ---- get_lesson -----------------------------------------------------------

  server.tool(
    'get_lesson',
    'Read the full content of a saved lesson by its ID.',
    {
      id: z.string().describe('Lesson ID (from list_lessons)'),
    },
    async ({ id }) => {
      const lesson = getLesson(lessonsDir, id);
      if (!lesson) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `No lesson found with id "${id}"` }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify(lesson, null, 2),
          },
        ],
      };
    },
  );

  // ---- delete_lesson --------------------------------------------------------

  server.tool(
    'delete_lesson',
    'Delete a saved lesson by its ID.',
    {
      id: z.string().describe('Lesson ID to delete (from list_lessons)'),
    },
    async ({ id }) => {
      const deleted = deleteLesson(lessonsDir, id);
      if (!deleted) {
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify({ error: `No lesson found with id "${id}"` }),
            },
          ],
          isError: true,
        };
      }

      return {
        content: [
          {
            type: 'text' as const,
            text: JSON.stringify({ success: true, deleted: id }),
          },
        ],
      };
    },
  );
}
