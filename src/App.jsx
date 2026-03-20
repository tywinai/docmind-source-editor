import { useMemo, useState, useCallback, useRef, useEffect, Suspense, lazy } from 'react';
import MarkdownIt from 'markdown-it';
import { getLayouts, layoutsToMarkdownRange } from './parser/parseDocmindJson';

const MDEditor = lazy(() => import('@uiw/react-md-editor').then(m => ({ default: m.default })));
const LARGE_DOC_THRESHOLD = 200000;

const EXPORT_THEMES = {
  parchment: {
    bodyBg: '#f5f4f0',
    bodyText: '#2a2522',
    paperBg: '#fffdf8',
    paperBorder: '#e6dfd5',
    h1Color: '#2e2218',
    h2Color: '#3a2b1f',
    h3Color: '#4a3728',
    h1Border: '#c68d57',
    h2Border: '#dcc5a7',
    h3Dot: '#b08968',
    h1Size: '34px',
    h2Size: '26px',
    h3Size: '20px',
    codeBg: '#1f1a17',
    codeText: '#f7f2ea',
    inlineCodeBg: '#f0ebe3',
    tableBorder: '#e2d8cb',
    quoteBorder: '#c68d57',
    quoteText: '#5f4a39',
    paperTexture: 'radial-gradient(circle at 1px 1px, rgba(70, 52, 34, 0.06) 1px, transparent 1px)',
    textureSize: '12px 12px',
  },
  ocean: {
    bodyBg: '#eef5fb',
    bodyText: '#1d2c39',
    paperBg: '#ffffff',
    paperBorder: '#cfe0ef',
    h1Color: '#12324a',
    h2Color: '#1f4665',
    h3Color: '#2a5d82',
    h1Border: '#2f7eb5',
    h2Border: '#9fc5df',
    h3Dot: '#3d89bd',
    h1Size: '34px',
    h2Size: '26px',
    h3Size: '20px',
    codeBg: '#0f2435',
    codeText: '#e9f4ff',
    inlineCodeBg: '#e5f1fb',
    tableBorder: '#c7dced',
    quoteBorder: '#2f7eb5',
    quoteText: '#245272',
    paperTexture: 'linear-gradient(135deg, rgba(37, 103, 145, 0.04) 25%, transparent 25%, transparent 50%, rgba(37, 103, 145, 0.04) 50%, rgba(37, 103, 145, 0.04) 75%, transparent 75%, transparent)',
    textureSize: '18px 18px',
  },
  graphite: {
    bodyBg: '#f3f4f6',
    bodyText: '#22252b',
    paperBg: '#ffffff',
    paperBorder: '#d9dde3',
    h1Color: '#111418',
    h2Color: '#20262d',
    h3Color: '#303943',
    h1Border: '#4b5563',
    h2Border: '#b8c2ce',
    h3Dot: '#6b7280',
    h1Size: '34px',
    h2Size: '26px',
    h3Size: '20px',
    codeBg: '#161b22',
    codeText: '#eef2f7',
    inlineCodeBg: '#eceff3',
    tableBorder: '#d4d9df',
    quoteBorder: '#4b5563',
    quoteText: '#374151',
    paperTexture: 'linear-gradient(0deg, rgba(75, 85, 99, 0.04) 1px, transparent 1px)',
    textureSize: '100% 14px',
  },
};

const md = new MarkdownIt({ html: true, breaks: true, linkify: true });

function getDocIdFromFileName(name) {
  if (!name) return `doc-${Date.now()}`;
  return name.replace(/\.[^/.]+$/, '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

function parseSourceTags(markdown) {
  const regex = /<!--\s*#src:([^>]+)-->/g;
  const tags = [];
  let match;
  while ((match = regex.exec(markdown)) !== null) {
    const params = {};
    match[1].split(';').forEach(p => {
      const [k, v] = p.split('=');
      if (k && v) params[k.trim()] = v.trim();
    });
    tags.push({ ...params, _raw: match[0], _index: match.index });
  }
  return tags;
}

function parseLLMResponse(responseMarkdown, originalSources) {
  const sourceMap = new Map();
  originalSources.forEach((s) => sourceMap.set(s.uniqueId || s.uid, s));
  
  const lines = responseMarkdown.split('\n');
  const result = [];
  let currentBlock = null;
  let blockContent = [];
  
  for (const line of lines) {
    const refMatch = line.match(/\[src:([^\]]+)\]/);
    const tagMatch = line.match(/<!--\s*#src:([^>]+)-->/);
    
    if (refMatch || tagMatch) {
      if (currentBlock) {
        currentBlock.content = blockContent.join('\n').trim();
        result.push(currentBlock);
      }
      
      const sourceId = (refMatch?.[1] || tagMatch?.[1]?.split(';')[0]?.split('=')[1]) || '';
      const source = sourceMap.get(sourceId);
      
      currentBlock = {
        sourceId,
        source: source || null,
        content: ''
      };
      blockContent = [];
    } else if (currentBlock) {
      blockContent.push(line);
    }
  }
  
  if (currentBlock) {
    currentBlock.content = blockContent.join('\n').trim();
    result.push(currentBlock);
  }
  
  return result;
}

function generateSourceComment(docId, uid, page, idx) {
  return `<src doc="${docId}" uid="${uid}" page="${page}" idx="${idx}">`;
}

function exportSourceJson(markdown, docTitle) {
  const tags = parseSourceTags(markdown);
  const json = JSON.stringify({ docTitle, fragments: tags }, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${docTitle || 'sources'}-溯源清单.json`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportWithSourceTags(markdown, docId) {
  const sources = parseSourceTags(markdown);
  const formatted = sources.map(s => ({
    uid: s.uid,
    docId: s.doc,
    page: s.page,
    idx: s.idx,
    source_line: s._index
  }));
  
  const meta = JSON.stringify({
    docId,
    generated: new Date().toISOString(),
    source_count: sources.length,
    sources: formatted
  }, null, 2);
  
  const combined = `<!-- SOURCE_META: ${meta} -->\n\n${markdown}`;
  const blob = new Blob([combined], { type: 'text/markdown' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${docId}-带溯源.md`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function exportHtml(markdown, docTitle, themeKey = 'parchment') {
  const theme = EXPORT_THEMES[themeKey] || EXPORT_THEMES.parchment;
  const body = md.render(markdown || '');
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${docTitle}</title>
  <style>
    body { margin: 0; font-family: "Noto Serif SC", "PingFang SC", "Microsoft YaHei", serif; background: ${theme.bodyBg}; color: ${theme.bodyText}; }
    .wrap { max-width: 900px; margin: 0 auto; padding: 48px 24px; }
    .paper { background: ${theme.paperBg}; border: 1px solid ${theme.paperBorder}; border-radius: 12px; box-shadow: 0 18px 40px rgba(28, 21, 15, 0.08); padding: 48px; position: relative; overflow: hidden; }
    .paper::before { content: ""; position: absolute; inset: 0; background-image: ${theme.paperTexture}; background-size: ${theme.textureSize}; opacity: 0.8; pointer-events: none; }
    .paper > * { position: relative; z-index: 1; }
    h1 { color: ${theme.h1Color}; font-size: ${theme.h1Size}; margin-top: 1.6em; margin-bottom: 0.7em; border-bottom: 3px solid ${theme.h1Border}; padding-bottom: 0.25em; letter-spacing: 0.4px; }
    h2 { color: ${theme.h2Color}; font-size: ${theme.h2Size}; margin-top: 1.5em; margin-bottom: 0.6em; border-left: 6px solid ${theme.h2Border}; padding-left: 0.5em; }
    h3 { color: ${theme.h3Color}; font-size: ${theme.h3Size}; margin-top: 1.35em; margin-bottom: 0.5em; }
    h3::before { content: "●"; color: ${theme.h3Dot}; margin-right: 0.45em; font-size: 0.75em; vertical-align: middle; }
    p, li { line-height: 1.8; font-size: 17px; }
    pre { background: ${theme.codeBg}; color: ${theme.codeText}; padding: 16px; border-radius: 8px; overflow-x: auto; }
    code { background: ${theme.inlineCodeBg}; padding: 0.15em 0.35em; border-radius: 4px; }
    table { width: 100%; border-collapse: collapse; margin: 16px 0; }
    th, td { border: 1px solid ${theme.tableBorder}; padding: 8px 10px; text-align: left; }
    blockquote { border-left: 4px solid ${theme.quoteBorder}; margin: 16px 0; padding: 6px 0 6px 14px; color: ${theme.quoteText}; }
    img { max-width: 100%; height: auto; }
  </style>
</head>
<body>
  <div class="wrap">
    <article class="paper markdown-body">${body}</article>
  </div>
</body>
</html>`;

  const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${docTitle || 'document'}.html`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

export default function App() {
  const [value, setValue] = useState('# DocMind 教材编辑器\n\n请导入 JSON 或 Markdown 开始编辑。\n');
  const [docId, setDocId] = useState(`doc-${Date.now()}`);
  const [status, setStatus] = useState('就绪');
  const [isLoading, setIsLoading] = useState(false);
  const [showSourcePanel, setShowSourcePanel] = useState(false);
  const [fragments, setFragments] = useState([]);
  const [editorMode, setEditorMode] = useState('auto');
  const [theme, setTheme] = useState('parchment');
  const [allLayouts, setAllLayouts] = useState([]);
  const [cursor, setCursor] = useState(0);
  const [chunkSize] = useState(200);
  const [isChunkLoading, setIsChunkLoading] = useState(false);
  const [autoLoadNext, setAutoLoadNext] = useState(true);
  const [richPreviewMode, setRichPreviewMode] = useState('live');
  const editorWrapRef = useRef(null);
  const syncingScrollRef = useRef(false);

  const isLargeDoc = value.length > LARGE_DOC_THRESHOLD;
  const usePlainEditor = editorMode === 'plain' || (editorMode === 'auto' && isLargeDoc);
  const lineCount = useMemo(() => {
    if (!value) return 0;
    if (isLargeDoc) return '大文档';
    return value.split('\n').length;
  }, [value, isLargeDoc]);

  const handleChange = useCallback((v) => {
    setValue(v || '');
  }, []);

  const handleImportJson = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setStatus('正在解析 JSON...');

    try {
      await new Promise((resolve) => setTimeout(resolve, 0));
      const text = await file.text();
      const json = JSON.parse(text);
      const nextDocId = getDocIdFromFileName(file.name);
      const layouts = getLayouts(json);
      const first = layoutsToMarkdownRange(layouts, nextDocId, 0, chunkSize);
      setDocId(nextDocId);
      setAllLayouts(layouts);
      setCursor(first.nextCursor);
      setFragments(first.fragments);
      setValue(first.markdown || '');
      if ((first.markdown || '').length > LARGE_DOC_THRESHOLD) {
        setEditorMode('plain');
      }
      setStatus(`JSON 导入成功：已加载 ${first.fragments.length}/${first.total} 个片段`);
    } catch (error) {
      setStatus(`JSON 导入失败：${error.message}`);
    } finally {
      event.target.value = '';
      setIsLoading(false);
    }
  };

  const handleImportMd = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      setValue(text);
      setDocId(getDocIdFromFileName(file.name));
      const marks = text.match(/<!--\s*#src:[^>]+-->/g);
      setStatus(`Markdown 导入成功：检测到 ${marks ? marks.length : 0} 个溯源标记`);
    } catch (error) {
      setStatus(`Markdown 导入失败：${error.message}`);
    } finally {
      event.target.value = '';
    }
  };

  const onExportHtml = () => {
    exportHtml(value, docId || 'docmind-export', theme);
    setStatus('HTML 已导出');
  };

  const onExportSources = () => {
    exportSourceJson(value, docId);
    setStatus('溯源清单已导出');
  };

  const onTestTrace = (uid) => {
    const frag = fragments.find(f => f.uniqueId === uid);
    if (frag) {
      alert(`溯源信息：\n唯一ID: ${frag.uniqueId}\n文档ID: ${frag.docId}\n页码: ${frag.pageNum}\n索引: ${frag.index}\n类型: ${frag.type}`);
    }
  };

  const onExportWithSources = () => {
    exportWithSourceTags(value, docId);
    setStatus('带溯源 Markdown 已导出');
  };

  const onImportLLMResponse = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const text = await file.text();
      const traced = parseLLMResponse(text, fragments);
      
      let summary = `解析完成！\n共 ${traced.length} 个区块\n\n`;
      traced.slice(0, 5).forEach((t, i) => {
        summary += `${i + 1}. 来源: ${t.sourceId || '未知'}\n   页码: ${t.source?.pageNum || '?'}\n   内容: ${t.content?.slice(0, 50)}...\n\n`;
      });
      
      setStatus(`大模型回复已导入：${traced.length} 个区块已溯源`);
      alert(summary);
    } catch (error) {
      setStatus(`解析失败：${error.message}`);
    } finally {
      event.target.value = '';
    }
  };

  const onLoadNextChunk = useCallback(() => {
    if (!allLayouts.length || isChunkLoading || cursor >= allLayouts.length) return;
    setIsChunkLoading(true);
    const next = layoutsToMarkdownRange(allLayouts, docId, cursor, chunkSize);
    if (!next.fragments.length) {
      setStatus('已经全部加载完成');
      setIsChunkLoading(false);
      return;
    }

    setValue((prev) => `${prev}${prev.endsWith('\n') ? '' : '\n'}${next.markdown}`);
    setFragments((prev) => prev.concat(next.fragments));
    setCursor(next.nextCursor);
    setStatus(`继续加载：已加载 ${next.nextCursor}/${next.total} 个片段`);
    setIsChunkLoading(false);
  }, [allLayouts, chunkSize, cursor, docId, isChunkLoading]);

  useEffect(() => {
    if (!autoLoadNext) return;
    const root = editorWrapRef.current;
    if (!root) return;

    const onScroll = (event) => {
      if (isChunkLoading || cursor >= allLayouts.length) return;
      const target = event.target;
      if (!target || typeof target.scrollTop !== 'number') return;
      const remain = target.scrollHeight - target.scrollTop - target.clientHeight;
      if (remain < 120) {
        onLoadNextChunk();
      }
    };

    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [allLayouts.length, autoLoadNext, cursor, isChunkLoading, onLoadNextChunk]);

  useEffect(() => {
    if (usePlainEditor || richPreviewMode !== 'live') return;
    const root = editorWrapRef.current;
    if (!root) return;

    const getTextScroller = () =>
      root.querySelector('.w-md-editor-text-input, .w-md-editor-text-pre');
    const getPreviewScroller = () =>
      root.querySelector('.w-md-editor-preview');

    const syncByRatio = (from, to) => {
      const fromMax = from.scrollHeight - from.clientHeight;
      const toMax = to.scrollHeight - to.clientHeight;
      if (fromMax <= 0 || toMax <= 0) return;
      const ratio = from.scrollTop / fromMax;
      to.scrollTop = ratio * toMax;
    };

    const onScroll = (event) => {
      if (syncingScrollRef.current) return;
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;

      const textScroller = getTextScroller();
      const previewScroller = getPreviewScroller();
      if (!textScroller || !previewScroller) return;

      const fromText = target === textScroller || textScroller.contains(target);
      const fromPreview = target === previewScroller || previewScroller.contains(target);
      if (!fromText && !fromPreview) return;

      syncingScrollRef.current = true;
      if (fromText) syncByRatio(textScroller, previewScroller);
      if (fromPreview) syncByRatio(previewScroller, textScroller);
      requestAnimationFrame(() => {
        syncingScrollRef.current = false;
      });
    };

    root.addEventListener('scroll', onScroll, true);
    return () => root.removeEventListener('scroll', onScroll, true);
  }, [richPreviewMode, usePlainEditor, value]);

  return (
    <main className={`app-shell theme-${theme}`}>
      <header className="topbar">
        <div>
          <h1>DocMind 教材编辑器</h1>
          <p>PDF 解析结果二次编辑与教材 HTML 导出</p>
        </div>
        <div className="meta">{lineCount} 行</div>
      </header>

      <section className="toolbar">
        <label className="file-btn">
          导入 JSON
          <input type="file" accept=".json" onChange={handleImportJson} />
        </label>
        <label className="file-btn">
          导入 Markdown
          <input type="file" accept=".md,text/markdown" onChange={handleImportMd} />
        </label>
        <button className="primary" type="button" onClick={onExportHtml}>
          导出 HTML
        </button>
        <select className="theme-select" value={theme} onChange={(e) => setTheme(e.target.value)}>
          <option value="parchment">主题: 书卷</option>
          <option value="ocean">主题: 海蓝</option>
          <option value="graphite">主题: 石墨</option>
        </select>
        <button className="secondary" type="button" onClick={onExportSources}>
          导出溯源清单
        </button>
        <button className="secondary" type="button" onClick={() => setShowSourcePanel(!showSourcePanel)}>
          {showSourcePanel ? '隐藏' : '显示'}溯源面板
        </button>
        <button className="secondary" type="button" onClick={onExportWithSources}>
          导出溯源MD
        </button>
        <label className="secondary file-btn">
          导入大模型回复
          <input type="file" accept=".md,.txt" onChange={onImportLLMResponse} />
        </label>
        <button className="secondary" type="button" onClick={() => setEditorMode('auto')}>
          自动模式
        </button>
        <button className="secondary" type="button" onClick={() => setEditorMode('plain')}>
          轻量编辑
        </button>
        <button className="secondary" type="button" onClick={() => setEditorMode('rich')}>
          富文本编辑
        </button>
        <button className="secondary" type="button" onClick={onLoadNextChunk}>
          加载下一批
        </button>
        <button className="secondary" type="button" onClick={() => setAutoLoadNext((v) => !v)}>
          {autoLoadNext ? '自动续载:开' : '自动续载:关'}
        </button>
        <button className="secondary" type="button" onClick={() => setRichPreviewMode('edit')}>
          仅编辑
        </button>
        <button className="secondary" type="button" onClick={() => setRichPreviewMode('live')}>
          编辑+预览
        </button>
        <button className="secondary" type="button" onClick={() => setRichPreviewMode('preview')}>
          仅预览
        </button>
        <span className="status">{status}</span>
      </section>

      <section ref={editorWrapRef} className="editor-wrap" data-color-mode="light">
        {isLoading && <div className="loading-overlay">正在导入大文件，请稍候...</div>}
        {usePlainEditor ? (
          <textarea
            className="simple-editor"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="轻量编辑模式"
          />
        ) : (
          <Suspense
            fallback={
              <textarea
                className="simple-editor"
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="编辑器加载中..."
              />
            }
          >
            <MDEditor value={value} onChange={handleChange} height={680} preview={richPreviewMode} />
          </Suspense>
        )}
      </section>

      {showSourcePanel && (
        <section className="source-panel">
          <h3>溯源测试面板</h3>
          <div className="source-stats">
            共 {fragments.length} 个片段 | 
            当前模式: {usePlainEditor ? '轻量' : '富文本'} | 
            分块进度: {allLayouts.length ? `${cursor}/${allLayouts.length}` : '0/0'} | 
            自动续载: {autoLoadNext ? '开' : '关'}
          </div>
          <div className="source-list">
            {fragments.slice(0, 50).map((frag, i) => (
              <div key={frag.uniqueId} className="source-item" onClick={() => onTestTrace(frag.uniqueId)}>
                <span className="source-idx">[{i}]</span>
                <span className="source-page">P{frag.pageNum}</span>
                <span className="source-type">{frag.type}</span>
                <span className="source-preview">{frag.content.slice(0, 30)}...</span>
                <span className="source-uid">{frag.uniqueId.slice(0, 8)}</span>
              </div>
            ))}
            {fragments.length > 50 && <div className="source-more">...还有 {fragments.length - 50} 个</div>}
          </div>
        </section>
      )}
    </main>
  );
}
