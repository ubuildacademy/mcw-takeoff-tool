import { describe, it, expect } from 'vitest';
import { packKnowledgeBase, splitIntoSections } from './kbPacking';

describe('splitIntoSections', () => {
  it('treats headerless content as a single section', () => {
    const content = 'Just some plain reference text with no headers at all.\nSecond line.';
    const sections = splitIntoSections(content);
    expect(sections).toHaveLength(1);
    expect(sections[0].title).toBeNull();
    expect(sections[0].text).toBe(content);
  });

  it('splits on the inline === TITLE === convention', () => {
    const content = [
      '=== INTRO ===',
      'Intro body text.',
      '=== DETAILS ===',
      'Details body text.',
    ].join('\n');
    const sections = splitIntoSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('INTRO');
    expect(sections[1].title).toBe('DETAILS');
  });

  it('splits on the inline ---TITLE--- convention', () => {
    const content = [
      '---INTRO---',
      'Intro body text.',
      '---DETAILS---',
      'Details body text.',
    ].join('\n');
    const sections = splitIntoSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('INTRO');
    expect(sections[1].title).toBe('DETAILS');
  });

  it('splits on the divider/title/divider block convention used by built-in trade KBs', () => {
    const content = [
      '-----------------------------------------------------------',
      'SECTION 1: WATERPROOFING MEMBRANE SYSTEMS',
      '-----------------------------------------------------------',
      '',
      'Membrane body text.',
      '-----------------------------------------------------------',
      'SECTION 2: TRAFFIC COATINGS',
      '-----------------------------------------------------------',
      '',
      'Coating body text.',
    ].join('\n');
    const sections = splitIntoSections(content);
    expect(sections).toHaveLength(2);
    expect(sections[0].title).toBe('SECTION 1: WATERPROOFING MEMBRANE SYSTEMS');
    expect(sections[0].text).toContain('Membrane body text.');
    expect(sections[1].title).toBe('SECTION 2: TRAFFIC COATINGS');
    expect(sections[1].text).toContain('Coating body text.');
  });

  it('tolerates a mix of both header conventions in the same document', () => {
    const content = [
      '=== DIV 7 WATERPROOFING — REFERENCE ===',
      'Preamble text.',
      '-----------------------------------------------------------',
      'SECTION 1: MEMBRANE SYSTEMS',
      '-----------------------------------------------------------',
      'Membrane body.',
      '=== END DIV 7 WATERPROOFING — REFERENCE ===',
    ].join('\n');
    const sections = splitIntoSections(content);
    const titles = sections.map((s) => s.title);
    expect(titles).toEqual([
      'DIV 7 WATERPROOFING — REFERENCE',
      'SECTION 1: MEMBRANE SYSTEMS',
      'END DIV 7 WATERPROOFING — REFERENCE',
    ]);
  });
});

describe('packKnowledgeBase', () => {
  it('returns the content byte-identical when already under budget', () => {
    const content = [
      '=== DIV 7 WATERPROOFING — REFERENCE ===',
      '-----------------------------------------------------------',
      'SECTION 1: MEMBRANE SYSTEMS',
      '-----------------------------------------------------------',
      'Membrane body text about hot-applied rubberized asphalt.',
      '-----------------------------------------------------------',
      'SECTION 2: ASTM STANDARDS',
      '-----------------------------------------------------------',
      'ASTM D1970 governs self-adhering sheet membrane.',
    ].join('\n');
    expect(packKnowledgeBase(content, 'what ASTM standard applies?', 100000)).toBe(content);
  });

  it('keeps a relevant tail section alive even when it would otherwise be truncated (the observed bug)', () => {
    const filler = (label: string, repeats: number) =>
      Array.from({ length: repeats }, (_, i) => `${label} filler line ${i} about unrelated general notes.`).join('\n');

    const sectionA = [
      '-----------------------------------------------------------',
      'SECTION 1: WATERPROOFING MEMBRANE SYSTEMS',
      '-----------------------------------------------------------',
      filler('membrane', 20),
    ].join('\n');

    const sectionB = [
      '-----------------------------------------------------------',
      'SECTION 2: TRAFFIC COATINGS',
      '-----------------------------------------------------------',
      filler('coating', 20),
    ].join('\n');

    // The tail section — mirrors the real bug: ASTM standards content that lived
    // past the char budget and never reached the model under naive truncation.
    const sectionC = [
      '-----------------------------------------------------------',
      'SECTION 3: ASTM STANDARDS AND REFERENCES',
      '-----------------------------------------------------------',
      'ASTM D1970 covers self-adhering polymer-modified bituminous sheet membrane.',
      'ASTM D1227 governs emulsified asphalt used in related waterproofing systems.',
    ].join('\n');

    const content = [sectionA, sectionB, sectionC].join('\n\n');
    expect(content.length).toBeGreaterThan(1600); // confirm the fixture is actually over budget

    const budget = 1000; // well under content.length, but bigger than sectionC alone
    const result = packKnowledgeBase(content, 'What ASTM standard governs self-adhering sheet membrane?', budget);

    expect(result.length).toBeLessThanOrEqual(budget);
    expect(result).toContain('ASTM D1970');
    expect(result).toContain('SECTION 3: ASTM STANDARDS AND REFERENCES');
  });

  it('always includes a section whose header directly matches the question, even over a higher-scoring section', () => {
    const sectionX = [
      '=== DIMENSIONAL TOLERANCES ===',
      'See manufacturer literature for exact tolerance dimensional values; consult local code.',
    ].join('\n');

    // Scores higher on term frequency (repeats question tokens many times) but its
    // header has no relation to the question at all.
    const sectionY = [
      '=== GENERAL NOTES FILLER MARKER ===',
      Array.from({ length: 8 }, () => 'panel joints panel joints').join(' '),
    ].join('\n');

    const content = [sectionX, sectionY].join('\n\n');
    const budget = 200; // fits roughly one section, not both

    const result = packKnowledgeBase(content, 'What are the dimensional tolerances for panel joints?', budget);

    expect(result).toContain('DIMENSIONAL TOLERANCES');
    expect(result).not.toContain('GENERAL NOTES FILLER MARKER');
  });

  it('never cuts a section mid-body — every included section is byte-identical to its original text', () => {
    const makeSection = (n: number) =>
      [
        `=== SECTION ${n} ===`,
        Array.from({ length: 10 }, (_, i) => `Section ${n} line ${i} of reference content.`).join('\n'),
      ].join('\n');

    const sections = [makeSection(1), makeSection(2), makeSection(3)];
    const content = sections.join('\n\n');
    const budget = Math.floor(sections[0].length * 1.5);

    const result = packKnowledgeBase(content, 'reference content section', budget);

    // Whatever got included must exactly match one of the original whole sections
    // (as the splitter itself carves them) — never a partial/truncated fragment.
    const originalSectionTexts = splitIntoSections(content).map((s) => s.text);
    const resultParts = splitIntoSections(result);
    expect(resultParts.length).toBeGreaterThan(0);
    for (const part of resultParts) {
      expect(originalSectionTexts).toContain(part.text);
    }
  });

  it('returns empty output rather than a partial cut when a single headerless section does not fit', () => {
    const content = 'x'.repeat(500);
    const result = packKnowledgeBase(content, 'anything', 100);
    expect(result === '' || result === content).toBe(true);
  });
});
