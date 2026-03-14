import { describe, it, expect, beforeAll } from 'vitest';
import path from 'path';
import { fileURLToPath } from 'url';
import { TagIndex } from '../lib/tag-index.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TAGS_DIR = path.join(__dirname, '..', '..', '.docs', 'tags');

let tags: TagIndex;

beforeAll(async () => {
  tags = await TagIndex.load(TAGS_DIR);
});

describe('TagIndex', () => {
  it('loads all 37 tag categories', () => {
    expect(tags.categories.length).toBe(37);
  });

  it('has a positive total tag count', () => {
    expect(tags.totalTagCount).toBeGreaterThan(0);
  });

  it('returns sections for a known category', () => {
    const sections = tags.getCategory('att');
    expect(sections).toBeDefined();
    expect(sections!.length).toBeGreaterThan(0);
    expect(sections![0]!.tags.length).toBeGreaterThan(0);
  });

  it('returns undefined for unknown category', () => {
    expect(tags.getCategory('nonexistent_xyz')).toBeUndefined();
  });

  it('getAll returns all categories', () => {
    const all = tags.getAll();
    expect(all.length).toBe(37);
    for (const entry of all) {
      expect(entry.category).toBeTruthy();
      expect(Array.isArray(entry.sections)).toBe(true);
    }
  });

  it('search returns results for known term', () => {
    const results = tags.search('attendance');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]).toHaveProperty('category');
    expect(results[0]).toHaveProperty('tag');
  });

  it('search returns empty array for nonsense query', () => {
    expect(tags.search('xyzzy_notareal_term_999')).toEqual([]);
  });
});
