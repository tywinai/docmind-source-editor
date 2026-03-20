function normalizeLayouts(input) {
  if (Array.isArray(input)) return input;
  if (Array.isArray(input?.layouts)) return input.layouts;
  if (Array.isArray(input?.data?.layouts)) return input.data.layouts;
  if (Array.isArray(input?.Data?.layouts)) return input.Data.layouts;
  return [];
}

export function getLayouts(input) {
  return normalizeLayouts(input);
}

function getBlockContent(layout) {
  const markdown = typeof layout?.markdownContent === 'string' ? layout.markdownContent : '';
  const text = typeof layout?.text === 'string' ? layout.text : '';
  return (markdown || text).trim();
}

function sourceTag(docId, layout, fallbackIndex) {
  const uid = layout?.uniqueId ?? `idx-${fallbackIndex}`;
  const page = layout?.pageNum ?? 'na';
  const index = layout?.index ?? fallbackIndex;
  return `<!-- #src:doc=${docId};uid=${uid};page=${page};idx=${index} -->`;
}

export function layoutsToMarkdown(layoutInput, docId = 'unknown-doc') {
  const layouts = normalizeLayouts(layoutInput);
  const fragments = [];
  const chunks = [];

  layouts.forEach((layout, i) => {
    const content = getBlockContent(layout);
    if (!content) return;

    const tag = sourceTag(docId, layout, i);
    chunks.push(tag, content, '');

    fragments.push({
      docId,
      uniqueId: layout?.uniqueId ?? `idx-${i}`,
      index: layout?.index ?? i,
      pageNum: layout?.pageNum ?? null,
      type: layout?.type ?? 'unknown',
      content,
    });
  });

  return {
    markdown: chunks.join('\n').trim() + '\n',
    fragments,
  };
}

export function parseDocmindJson(raw, docId = 'unknown-doc') {
  const layouts = normalizeLayouts(raw);
  return layoutsToMarkdown(layouts, docId);
}

export function layoutsToMarkdownRange(layoutInput, docId = 'unknown-doc', start = 0, limit = 200) {
  const layouts = normalizeLayouts(layoutInput);
  const safeStart = Math.max(0, start);
  const safeLimit = Math.max(1, limit);
  const range = layouts.slice(safeStart, safeStart + safeLimit);
  const { markdown, fragments } = layoutsToMarkdown(range, docId);
  return {
    markdown,
    fragments,
    total: layouts.length,
    nextCursor: safeStart + range.length,
    hasMore: safeStart + range.length < layouts.length,
  };
}
