require('dotenv').config();

const fs = require('fs');
const path = require('path');

function loadDocmindSdk() {
  const candidates = [
    process.env.ALIYUN_DOCMIND_SDK,
    '@alicloud/docmind-sdk',
    '@alicloud/docmind-20220711',
    '@alicloud/docmind20220711',
  ].filter(Boolean);

  for (const name of candidates) {
    try {
      return require(name);
    } catch (error) {
      if (error && error.code !== 'MODULE_NOT_FOUND') throw error;
    }
  }

  throw new Error(
    'DocMind SDK not found. Install your internal/official SDK package and set ALIYUN_DOCMIND_SDK if needed.'
  );
}

const Client = loadDocmindSdk();

function blockContent(layout) {
  const markdown = typeof layout?.markdownContent === 'string' ? layout.markdownContent : '';
  const text = typeof layout?.text === 'string' ? layout.text : '';
  return (markdown || text).trim();
}

function layoutsToMarkdown(layouts, docId) {
  const fragments = [];
  const lines = [];

  layouts.forEach((layout, i) => {
    const content = blockContent(layout);
    if (!content) return;

    const uid = layout?.uniqueId ?? `idx-${i}`;
    const page = layout?.pageNum ?? 'na';
    const index = layout?.index ?? i;

    lines.push(`<!-- #src:doc=${docId};uid=${uid};page=${page};idx=${index} -->`);
    lines.push(content);
    lines.push('');

    fragments.push({
      docId,
      uniqueId: uid,
      index,
      pageNum: layout?.pageNum ?? null,
      type: layout?.type ?? 'unknown',
      content,
    });
  });

  return {
    markdown: lines.join('\n').trim() + '\n',
    fragments,
  };
}

const client = new Client({
  accessKeyId: process.env.ALIYUN_ACCESS_KEY_ID,
  accessKeySecret: process.env.ALIYUN_ACCESS_KEY_SECRET,
  endpoint: process.env.ALIYUN_DOCMIND_ENDPOINT || 'docmind-api.cn-hangzhou.aliyuncs.com',
});

async function submitJob(fileUrl) {
  const req = new Client.SubmitDocParserJobRequest({ fileUrl });
  const resp = await client.submitDocParserJob(req);
  return resp?.body?.Data?.id;
}

async function waitForJob(jobId, timeoutMs = 300000) {
  const start = Date.now();
  while (true) {
    const statusReq = new Client.QueryDocParserStatusRequest({ id: jobId });
    const statusResp = await client.queryDocParserStatus(statusReq);
    const status = statusResp?.body?.Data?.status;

    console.log(`Job ${jobId} status: ${status}`);

    if (status === 'success') return;
    if (status === 'failed') throw new Error('DocMind parser job failed');
    if (Date.now() - start > timeoutMs) throw new Error('DocMind parser timeout');

    await new Promise((resolve) => setTimeout(resolve, 5000));
  }
}

async function fetchAllLayouts(jobId) {
  const step = 100;
  let from = 0;
  const allLayouts = [];

  while (true) {
    const req = new Client.GetDocParserResultRequest({
      id: jobId,
      layoutNum: from,
      layoutStepSize: step,
    });
    const resp = await client.getDocParserResult(req);
    const layouts = resp?.body?.Data?.layouts || [];

    console.log(`Fetched layouts ${from}-${from + layouts.length}`);

    if (!layouts.length) break;
    allLayouts.push(...layouts);
    if (layouts.length < step) break;
    from += step;
  }

  return allLayouts;
}

async function parsePdfToMarkdown(pdfUrl, outputDir = './docs') {
  if (!process.env.ALIYUN_ACCESS_KEY_ID || !process.env.ALIYUN_ACCESS_KEY_SECRET) {
    throw new Error('Missing ALIYUN_ACCESS_KEY_ID or ALIYUN_ACCESS_KEY_SECRET in environment');
  }

  const jobId = await submitJob(pdfUrl);
  if (!jobId) throw new Error('Failed to get job id from SubmitDocParserJob');
  console.log(`Job submitted: ${jobId}`);

  await waitForJob(jobId);
  const layouts = await fetchAllLayouts(jobId);
  console.log(`Total layouts: ${layouts.length}`);

  const { markdown, fragments } = layoutsToMarkdown(layouts, jobId);

  const safeDocId = jobId.replace(/[^a-zA-Z0-9_-]/g, '_');
  fs.mkdirSync(outputDir, { recursive: true });

  const mdFile = path.join(outputDir, `${safeDocId}.md`);
  const fragFile = path.join(outputDir, `${safeDocId}-fragments.json`);

  fs.writeFileSync(mdFile, markdown, 'utf-8');
  fs.writeFileSync(fragFile, JSON.stringify(fragments, null, 2), 'utf-8');

  console.log(`Generated: ${mdFile}`);
  console.log(`Generated: ${fragFile}`);

  return { docId: safeDocId, markdown, fragments };
}

if (require.main === module) {
  const [, , pdfUrl, outputDir] = process.argv;
  if (!pdfUrl) {
    console.log('Usage: node scripts/docmind-parser.cjs <PDF_URL> [outputDir]');
    process.exit(1);
  }

  parsePdfToMarkdown(pdfUrl, outputDir || './docs').catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = { parsePdfToMarkdown };
