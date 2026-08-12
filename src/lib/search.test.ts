/**
 * Search ranking.
 *
 * Whether search is useful or useless is entirely a question of order: everything
 * matches something, and if the thing you meant is eighth you'd have been quicker
 * browsing. Verifying that by squinting at a dropdown is exactly how it silently
 * regresses, so the ordering is asserted directly.
 */
import { describe, it, expect } from 'vitest';
import { search, type SearchSources } from './search';
import type { Questline, Routine } from '../types';
import type { VynuesProject } from '../vynuesStore';

const routine = (id: string, title: string, over: Partial<Routine> = {}): Routine => ({
  id, title, recurring: null, completed: false, trackedToday: false, ...over,
});

const sources = (over: Partial<SearchSources> = {}): SearchSources => ({
  questlines: [], routines: [], projects: [], ...over,
});

const titles = (rs: ReturnType<typeof search>) => rs.map(r => r.title);

describe('search', () => {
  it('matches nothing on an empty query', () => {
    // A palette that lists your whole app before you type is noise.
    expect(search(sources({ routines: [routine('r1', 'Gym')] }), '   ')).toEqual([]);
  });

  it('ranks an exact title above a prefix above a buried substring', () => {
    const rs = search(sources({ routines: [
      routine('r1', 'Weekly gym recap'),
      routine('r2', 'Gym'),
      routine('r3', 'Gym bag'),
    ] }), 'gym');
    expect(titles(rs)).toEqual(['Gym', 'Gym bag', 'Weekly gym recap']);
  });

  it('prefers a word boundary to a mid-word hit', () => {
    const rs = search(sources({ routines: [
      routine('r1', 'Algymnastics'),
      routine('r2', 'Go to the gym'),
    ] }), 'gym');
    expect(titles(rs)[0]).toBe('Go to the gym');
  });

  it('puts the shorter title first at equal match quality', () => {
    const rs = search(sources({ routines: [
      routine('r1', 'Read the whole standards document'),
      routine('r2', 'Read'),
    ] }), 'read');
    expect(titles(rs)).toEqual(['Read', 'Read the whole standards document']);
  });

  it('narrows on a second term rather than widening', () => {
    const rs = search(sources({ routines: [
      routine('r1', 'Read 15 minutes'),
      routine('r2', 'Read the docs'),
      routine('r3', 'Walk 15 minutes'),
    ] }), 'read 15');
    expect(titles(rs)).toEqual(['Read 15 minutes']);
  });

  it('matches on the parent, but ranks it below a title hit', () => {
    const questlines: Questline[] = [{
      id: 'ql', title: 'Fitness', description: '', icon: '', color: 'amber',
      quests: [{ id: 'q1', title: 'Base', description: '', order: 1, actions: [{ id: 'a1', title: 'Squats', completed: false }] }],
    }];
    const rs = search(sources({ questlines, routines: [routine('r1', 'Fitness review')] }), 'fitness');
    // "Squats" only matches because its questline is called Fitness — real, but
    // never what you meant ahead of something actually named that.
    expect(titles(rs).indexOf('Squats')).toBeGreaterThan(titles(rs).indexOf('Fitness'));
    expect(titles(rs)).toContain('Squats');
  });

  it('puts the things you act on ahead of the containers they live in', () => {
    const questlines: Questline[] = [{
      id: 'ql', title: 'Water', description: '', icon: '', color: 'sapphire',
      quests: [{ id: 'q1', title: 'Water', description: '', order: 1, actions: [] }],
    }];
    const rs = search(sources({ questlines, routines: [routine('r1', 'Water')] }), 'water');
    expect(titles(rs)).toHaveLength(3);
    expect(rs[0].kind).toBe('routine');
    expect(rs[rs.length - 1].kind).toBe('questline');
  });

  it('reaches nested steps, on both stores', () => {
    const projects: VynuesProject[] = [{
      id: 'p1', name: 'Website', description: '', color: 'amber', status: 'active', createdAt: '',
      tasks: [{ id: 't1', title: 'Launch', done: false, priority: 'medium', createdAt: '', subtasks: [
        { id: 's1', title: 'Buy the domain', done: false, children: [{ id: 's2', title: 'Compare registrars', done: false }] },
      ] }],
    }];
    const routines = [routine('r1', 'Errands', { subtasks: [{ id: 'x1', title: 'Compare insurance', completed: false }] })];
    const rs = search(sources({ projects, routines }), 'compare');
    expect(titles(rs).sort()).toEqual(['Compare insurance', 'Compare registrars']);
    expect(rs.every(r => r.kind === 'step')).toBe(true);
  });

  it('routes each kind somewhere that actually contains it', () => {
    const questlines: Questline[] = [{
      id: 'ql7', title: 'Health', description: '', icon: '', color: 'amber',
      quests: [{ id: 'q1', title: 'Base', description: '', order: 1, actions: [{ id: 'a1', title: 'Base squats', completed: false }] }],
    }];
    const projects: VynuesProject[] = [{
      id: 'p1', name: 'Base site', description: '', color: 'amber', status: 'active', createdAt: '', tasks: [],
    }];
    const byKind = Object.fromEntries(
      search(sources({ questlines, projects, routines: [routine('r1', 'Base habit')] }), 'base').map(r => [r.kind, r.path]),
    );
    // Quests and actions have no route of their own, so they resolve to the
    // questline page that holds them rather than to a dead link.
    expect(byKind.quest).toBe('/questline/ql7');
    expect(byKind.action).toBe('/questline/ql7');
    expect(byKind.routine).toBe('/all');
    expect(byKind.project).toBe('/vynues');
  });

  it('is case- and whitespace-insensitive', () => {
    const rs = search(sources({ routines: [routine('r1', 'Deep Work')] }), '  DEEP   work ');
    expect(titles(rs)).toEqual(['Deep Work']);
  });

  it('treats regex metacharacters as literal text', () => {
    // Without escaping, a stray "(" in a task title turns the query into an
    // invalid pattern and the whole palette throws.
    const rs = search(sources({ routines: [routine('r1', 'Invoice (Q3)')] }), '(q3)');
    expect(titles(rs)).toEqual(['Invoice (Q3)']);
  });

  it('honours the result cap', () => {
    const many = Array.from({ length: 50 }, (_, i) => routine(`r${i}`, `Task ${i}`));
    expect(search(sources({ routines: many }), 'task', 5)).toHaveLength(5);
  });
});
