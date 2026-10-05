(() => {
  const STORAGE_KEY = 'arda-blog-admin-drafts-v1';
  const WORKING_KEY = 'arda-blog-admin-working-v1';
  const elements = {
    title: document.getElementById('post-title'),
    slug: document.getElementById('post-slug'),
    date: document.getElementById('post-date'),
    summary: document.getElementById('post-summary'),
    authors: document.getElementById('post-authors'),
    affiliation: document.getElementById('post-affiliation'),
    body: document.getElementById('post-body'),
    preview: document.getElementById('post-preview'),
    status: document.getElementById('save-status'),
    draftList: document.getElementById('draft-list'),
    newDraft: document.getElementById('new-draft'),
    saveDraft: document.getElementById('save-draft'),
    download: document.getElementById('download-post'),
    unlockPublishing: document.getElementById('unlock-publishing'),
    publish: document.getElementById('publish-post'),
    lockPublishing: document.getElementById('lock-publishing'),
    publisherLogin: document.getElementById('publisher-login'),
    publisherLoginForm: document.getElementById('publisher-login-form'),
    publisherPassword: document.getElementById('publisher-password'),
    publisherLoginError: document.getElementById('publisher-login-error'),
    closePublisherLogin: document.getElementById('close-publisher-login'),
    cancelPublisherLogin: document.getElementById('cancel-publisher-login'),
    copyIndexEntry: document.getElementById('copy-index-entry'),
    openFigureBuilder: document.getElementById('open-figure-builder'),
    figureBuilder: document.getElementById('figure-builder'),
    figureBuilderForm: document.getElementById('figure-builder-form'),
    closeFigureBuilder: document.getElementById('close-figure-builder'),
    cancelFigureBuilder: document.getElementById('cancel-figure-builder'),
    resetFigureExample: document.getElementById('reset-figure-example'),
    submitFigureBuilder: document.getElementById('submit-figure-builder'),
    figureType: document.getElementById('figure-type'),
    figureAnimated: document.getElementById('figure-animated'),
    figureTitle: document.getElementById('figure-title'),
    figureCaption: document.getElementById('figure-caption'),
    figureXLabel: document.getElementById('figure-x-label'),
    figureYLabel: document.getElementById('figure-y-label'),
    figureXDescription: document.getElementById('figure-x-description'),
    figureYDescription: document.getElementById('figure-y-description'),
    figureData: document.getElementById('figure-data'),
    figureDataHelp: document.getElementById('figure-data-help'),
    figureBuilderError: document.getElementById('figure-builder-error')
  };

  let activeDraftId = '';
  let slugWasEdited = false;
  let statusTimer;
  let autosaveTimer;
  let editingFigureRange = null;

  function setPublisherState(available, authenticated) {
    elements.unlockPublishing.hidden = !available || authenticated;
    elements.publish.hidden = !authenticated;
    elements.lockPublishing.hidden = !authenticated;
  }

  async function checkPublisherStatus() {
    try {
      const response = await fetch('/api/auth/status', { headers: { accept: 'application/json' } });
      if (!response.ok) throw new Error('Publisher unavailable');
      const result = await response.json();
      setPublisherState(Boolean(result.available), Boolean(result.authenticated));
    } catch {
      setPublisherState(false, false);
    }
  }

  const escapeHtml = value => String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');

  const slugify = value => String(value ?? '')
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

  const safeUrl = value => {
    const url = String(value ?? '').trim();
    if (/^(https?:\/\/|\.\.\/|\.\/|\/|#)/i.test(url)) return escapeHtml(url);
    return '#';
  };

  function renderInteractiveFigure(source) {
    try {
      const config = JSON.parse(source);
      if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('The configuration must be a JSON object.');
      const serialized = escapeHtml(JSON.stringify(config));
      return `<figure class="line-chart-lab generated-scientific-figure" data-scientific-figure data-figure-config="${serialized}"></figure>`;
    } catch (error) {
      return `<div class="figure-config-error"><strong>Figure configuration error.</strong> ${escapeHtml(error.message)}</div>`;
    }
  }

  const formatDate = value => {
    if (!value) return 'Unpublished';
    const [year, month, day] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'long', day: 'numeric' }).format(new Date(year, month - 1, day));
  };

  const formatMonth = value => {
    if (!value) return '';
    const [year, month] = value.split('-').map(Number);
    return new Intl.DateTimeFormat('en-US', { year: 'numeric', month: 'short' }).format(new Date(year, month - 1, 1));
  };

  function renderInline(source) {
    const codeTokens = [];
    let html = escapeHtml(source).replace(/`([^`]+)`/g, (_, code) => {
      const token = `%%CODE${codeTokens.length}%%`;
      codeTokens.push(`<code>${code}</code>`);
      return token;
    });
    html = html
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, (_, label, url) => `<a href="${safeUrl(url)}">${label}</a>`)
      .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
      .replace(/__([^_]+)__/g, '<strong>$1</strong>')
      .replace(/(^|[^*])\*([^*]+)\*/g, '$1<em>$2</em>')
      .replace(/(^|[^_])_([^_]+)_/g, '$1<em>$2</em>');
    codeTokens.forEach((token, index) => { html = html.replace(`%%CODE${index}%%`, token); });
    return html;
  }

  function renderMarkdown(markdown) {
    const lines = String(markdown ?? '').replace(/\r\n?/g, '\n').split('\n');
    const output = [];
    let paragraph = [];
    let listType = '';
    let code = [];
    let inCode = false;
    let codeLanguage = '';

    const flushParagraph = () => {
      if (!paragraph.length) return;
      output.push(`<p>${renderInline(paragraph.join(' '))}</p>`);
      paragraph = [];
    };
    const closeList = () => {
      if (!listType) return;
      output.push(`</${listType}>`);
      listType = '';
    };

    lines.forEach(line => {
      const fence = line.match(/^```\s*([\w-]*)\s*$/);
      if (fence) {
        flushParagraph();
        closeList();
        if (!inCode) {
          inCode = true;
          codeLanguage = fence[1];
          code = [];
        } else {
          if (codeLanguage === 'interactive-figure') {
            output.push(renderInteractiveFigure(code.join('\n')));
          } else {
            const languageClass = codeLanguage ? ` class="language-${escapeHtml(codeLanguage)}"` : '';
            output.push(`<pre><code${languageClass}>${escapeHtml(code.join('\n'))}</code></pre>`);
          }
          inCode = false;
          codeLanguage = '';
        }
        return;
      }
      if (inCode) {
        code.push(line);
        return;
      }
      if (!line.trim()) {
        flushParagraph();
        closeList();
        return;
      }
      const image = line.match(/^!\[([^\]]*)\]\(([^)]+)\)\s*$/);
      if (image) {
        flushParagraph();
        closeList();
        output.push(`<figure class="post-figure"><img src="${safeUrl(image[2])}" alt="${escapeHtml(image[1])}"><figcaption class="figure-caption">${renderInline(image[1])}</figcaption></figure>`);
        return;
      }
      const heading = line.match(/^(#{2,4})\s+(.+)$/);
      if (heading) {
        flushParagraph();
        closeList();
        const level = heading[1].length;
        output.push(`<h${level}>${renderInline(heading[2])}</h${level}>`);
        return;
      }
      const quote = line.match(/^>\s?(.+)$/);
      if (quote) {
        flushParagraph();
        closeList();
        output.push(`<blockquote><p>${renderInline(quote[1])}</p></blockquote>`);
        return;
      }
      const unordered = line.match(/^[-*+]\s+(.+)$/);
      const ordered = line.match(/^\d+\.\s+(.+)$/);
      if (unordered || ordered) {
        flushParagraph();
        const nextListType = unordered ? 'ul' : 'ol';
        if (listType !== nextListType) {
          closeList();
          listType = nextListType;
          output.push(`<${listType}>`);
        }
        output.push(`<li>${renderInline((unordered || ordered)[1])}</li>`);
        return;
      }
      closeList();
      paragraph.push(line.trim());
    });

    if (inCode) {
      if (codeLanguage === 'interactive-figure') output.push('<div class="figure-config-error"><strong>Figure configuration error.</strong> Close this block with three backticks.</div>');
      else output.push(`<pre><code>${escapeHtml(code.join('\n'))}</code></pre>`);
    }
    flushParagraph();
    closeList();
    return output.join('\n');
  }

  function getPostData() {
    return {
      id: activeDraftId,
      title: elements.title.value.trim(),
      slug: slugify(elements.slug.value),
      date: elements.date.value,
      summary: elements.summary.value.trim(),
      authors: elements.authors.value.trim(),
      affiliation: elements.affiliation.value.trim(),
      body: elements.body.value,
      updatedAt: new Date().toISOString()
    };
  }

  function setPostData(post) {
    activeDraftId = post.id || '';
    elements.title.value = post.title || '';
    elements.slug.value = post.slug || '';
    elements.date.value = post.date || '';
    elements.summary.value = post.summary || '';
    elements.authors.value = post.authors || 'Arda Uzunoğlu';
    elements.affiliation.value = post.affiliation || 'Johns Hopkins University';
    elements.body.value = post.body || '';
    slugWasEdited = Boolean(post.slug);
    updatePreview();
    persistWorkingCopy();
  }

  function metadataHtml(post) {
    return `<dl class="post-metadata">
      <div><dt>Authors</dt><dd>${escapeHtml(post.authors || '—')}</dd></div>
      <div><dt>Affiliation</dt><dd>${escapeHtml(post.affiliation || '—')}</dd></div>
      <div><dt>Published</dt><dd><time datetime="${escapeHtml(post.date)}">${escapeHtml(formatDate(post.date))}</time></dd></div>
    </dl>`;
  }

  function updatePreview() {
    const post = getPostData();
    window.ScientificFigures?.destroyAll(elements.preview);
    elements.preview.innerHTML = `<header class="post-header">
      <h1>${escapeHtml(post.title || 'Untitled post')}</h1>
      <p class="post-lede">${escapeHtml(post.summary || 'Add a concise summary for the post.')}</p>
      ${metadataHtml(post)}
    </header>
    <div class="post-content">${post.body.trim() ? renderMarkdown(post.body) : '<p class="preview-placeholder">Your rendered post will appear here.</p>'}</div>`;
    window.ScientificFigures?.renderAll(elements.preview);
  }

  function getDrafts() {
    try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; }
    catch { return []; }
  }

  function setDrafts(drafts) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(drafts));
  }

  function refreshDraftList() {
    const drafts = getDrafts().sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    elements.draftList.innerHTML = '<option value="">Unsaved draft</option>' + drafts.map(draft => `<option value="${escapeHtml(draft.id)}">${escapeHtml(draft.title || 'Untitled draft')}</option>`).join('');
    elements.draftList.value = activeDraftId;
  }

  function showStatus(message, duration = 2400) {
    window.clearTimeout(statusTimer);
    elements.status.textContent = message;
    statusTimer = window.setTimeout(() => { elements.status.textContent = 'Drafts stay in this browser'; }, duration);
  }

  function persistWorkingCopy() {
    window.clearTimeout(autosaveTimer);
    autosaveTimer = window.setTimeout(() => {
      localStorage.setItem(WORKING_KEY, JSON.stringify(getPostData()));
      showStatus('Autosaved locally');
    }, 500);
  }

  function saveDraft() {
    const post = getPostData();
    if (!post.id) post.id = `draft-${Date.now()}`;
    activeDraftId = post.id;
    const drafts = getDrafts();
    const existingIndex = drafts.findIndex(draft => draft.id === post.id);
    if (existingIndex >= 0) drafts[existingIndex] = post;
    else drafts.push(post);
    setDrafts(drafts);
    localStorage.setItem(WORKING_KEY, JSON.stringify(post));
    refreshDraftList();
    showStatus('Draft saved');
  }

  function createPostHtml(post) {
    const renderedBody = renderMarkdown(post.body);
    return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(post.title)} — Arda Uzunoğlu</title>
    <meta name="description" content="${escapeHtml(post.summary)}">
    <link rel="stylesheet" href="../../styles.css?v=20261005">
  </head>
  <body class="benshi-home subpage">
    <main class="profile-page">
      <nav class="profile-nav" aria-label="Primary navigation">
        <a href="../../index.html">home</a>
        <a class="active" href="../index.html">blog</a>
        <a href="../../awards/index.html">more</a>
      </nav>
      <article class="blog-post">
        <header class="post-header">
          <h1>${escapeHtml(post.title)}</h1>
          <p class="post-lede">${escapeHtml(post.summary)}</p>
          ${metadataHtml(post)}
        </header>
        <div class="post-content">
${renderedBody.split('\n').map(line => `          ${line}`).join('\n')}
        </div>
      </article>
    </main>
    <script src="../../figure-runtime.js?v=6"><\/script>
  </body>
</html>
`;
  }

  function validateForExport(post) {
    if (!post.title) return 'Add a title before exporting.';
    if (!post.slug) return 'Add a slug before exporting.';
    if (!post.date) return 'Add a publication date before exporting.';
    if (!post.body.trim()) return 'Write some post content before exporting.';
    return '';
  }

  function downloadPost() {
    const post = getPostData();
    const error = validateForExport(post);
    if (error) {
      showStatus(error);
      return;
    }
    const blob = new Blob([createPostHtml(post)], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'index.html';
    link.click();
    URL.revokeObjectURL(url);
    showStatus(`Downloaded for blog/${post.slug}/`);
  }

  async function publishPost() {
    const post = getPostData();
    const error = validateForExport(post);
    if (error) {
      showStatus(error, 5000);
      return;
    }
    if (!window.confirm(`Publish “${post.title}” to blog/${post.slug}/ and push main?`)) return;
    const originalLabel = elements.publish.textContent;
    elements.publish.disabled = true;
    elements.publish.textContent = 'Publishing…';
    showStatus('Writing, committing, and pushing…', 60000);
    try {
      const response = await fetch('/api/publish', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          slug: post.slug,
          title: post.title,
          html: createPostHtml(post),
          indexEntry: createIndexEntry(post)
        })
      });
      const result = await response.json();
      if (response.status === 401) {
        setPublisherState(true, false);
        elements.publisherLogin.showModal();
      }
      if (!response.ok || !result.ok) throw new Error(result.message || 'Publishing failed.');
      saveDraft();
      showStatus(result.message, 8000);
    } catch (publishError) {
      showStatus(publishError.message || 'Publishing failed.', 12000);
    } finally {
      elements.publish.disabled = false;
      elements.publish.textContent = originalLabel;
    }
  }

  function createIndexEntry(post) {
    const monthValue = post.date ? post.date.slice(0, 7) : '';
    return `<a class="blog-entry" href="./${escapeHtml(post.slug)}/index.html">
  <div>
    <h2>${escapeHtml(post.title)}</h2>
    <p>${escapeHtml(post.summary)}</p>
  </div>
  <time datetime="${escapeHtml(monthValue)}">${escapeHtml(formatMonth(post.date))}</time>
</a>`;
  }

  const figureExamples = {
    line: {
      fields: {
        title: 'Mean outcome by iteration.',
        caption: 'Points show mean ± standard deviation.',
        xLabel: 'Iteration',
        yLabel: 'Mean outcome',
        xDescription: 'The sequential observation number.',
        yDescription: 'The average outcome at each iteration.'
      },
      help: 'Use one or more series. Each value needs x and mean; std is optional. Series descriptions appear when readers hover over the legend.',
      data: {
        revealDelay: 600,
        fixedYLines: [{ value: 3.5, label: 'target = 3.50' }],
        series: [
          {
            name: 'Observed',
            description: 'Observed means with one standard deviation.',
            values: [
              { x: 1, mean: 2.1, std: 0.42 },
              { x: 2, mean: 2.45, std: 0.38 },
              { x: 3, mean: 2.3, std: 0.33 },
              { x: 4, mean: 2.87, std: 0.29 },
              { x: 5, mean: 3.15, std: 0.31 },
              { x: 6, mean: 3.54, std: 0.24 }
            ]
          },
          {
            name: 'Reference',
            description: 'A comparison trajectory without uncertainty.',
            dashed: true,
            values: [
              { x: 1, mean: 1.92 }, { x: 2, mean: 2.1 }, { x: 3, mean: 2.28 },
              { x: 4, mean: 2.52 }, { x: 5, mean: 2.73 }, { x: 6, mean: 3.16 }
            ]
          }
        ]
      }
    },
    bar: {
      fields: {
        title: 'Comparison across conditions.',
        caption: 'Bars show means and whiskers show one standard deviation.',
        xLabel: 'Condition',
        yLabel: 'Score',
        xDescription: 'The experimental condition being compared.',
        yDescription: 'The mean score for each condition.'
      },
      help: 'Use bars for one series or series with category-valued observations for grouped bars. Add std/error for whiskers, descriptions for hover text, and color to override the palette.',
      data: {
        duration: 1400,
        fixedYLines: [{ value: 70, label: 'target = 70' }],
        bars: [
          { label: 'A', mean: 42, std: 5, description: 'Baseline condition.' },
          { label: 'B', mean: 58, std: 4, description: 'Additional training data.' },
          { label: 'C', mean: 67, std: 6, description: 'Full intervention.' },
          { label: 'D', mean: 76, std: 3, description: 'Upper-bound condition.' }
        ]
      }
    },
    scatter: {
      fields: {
        title: 'Performance by data scale.',
        caption: 'Each point represents one experimental setting.',
        xLabel: 'Data scale',
        yLabel: 'Performance',
        xDescription: 'The amount of training data used.',
        yDescription: 'Performance on the evaluation set.'
      },
      help: 'Each point needs x and y. Labels and descriptions appear on hover; size and color are optional.',
      data: {
        revealDelay: 220,
        points: [
          { x: 1, y: 2, label: 'Run A' }, { x: 1.8, y: 2.3, label: 'Run B' },
          { x: 2.6, y: 2.5, label: 'Run C' }, { x: 3.4, y: 3, label: 'Run D' },
          { x: 4.2, y: 2.8, label: 'Run E' }, { x: 5, y: 3.5, label: 'Run F' }
        ]
      }
    },
    heatmap: {
      fields: {
        title: 'Matrix-valued results.',
        caption: 'Color intensity shows performance across datasets and model sizes.',
        xLabel: 'Model size',
        yLabel: 'Dataset',
        xDescription: 'The evaluated model scale.',
        yDescription: 'The evaluation dataset.'
      },
      help: 'The values matrix must have one row per y-label and one column per x-label.',
      data: {
        revealDelay: 90,
        xLabels: ['Small', 'Medium', 'Large', 'XL'],
        yLabels: ['Dataset A', 'Dataset B', 'Dataset C'],
        values: [
          [0.42, 0.56, 0.74, 0.83],
          [0.51, 0.63, 0.67, 0.81],
          [0.38, 0.54, 0.72, 0.77]
        ]
      }
    },
    carousel: {
      fields: {
        title: 'Swipeable results.',
        caption: 'Use the arrows or swipe to move between figures.',
        xLabel: 'x',
        yLabel: 'y',
        xDescription: '',
        yDescription: ''
      },
      help: 'Each item in figures is a complete line, bar, scatter, or heatmap configuration. Its own title, caption, labels, animation, and data are preserved.',
      data: {
        figures: [
          {
            type: 'line', animated: true,
            title: 'Training trajectory.', caption: 'Mean ± standard deviation.',
            xLabel: 'Step', yLabel: 'Score',
            xDescription: 'Training step.', yDescription: 'Evaluation score.',
            series: [{ name: 'Model', description: 'The primary training run.', values: [
              { x: 1, mean: 1.8, std: 0.2 }, { x: 2, mean: 2.4, std: 0.18 },
              { x: 3, mean: 3.1, std: 0.16 }, { x: 4, mean: 3.7, std: 0.14 }
            ] }]
          },
          {
            type: 'bar', animated: true,
            title: 'Final comparison.', caption: 'Means with one standard deviation.',
            xLabel: 'Method', yLabel: 'Score',
            xDescription: 'The evaluated method.', yDescription: 'Final evaluation score.',
            bars: [
              { label: 'Base', mean: 42, std: 4 },
              { label: 'Ours', mean: 68, std: 3 },
              { label: 'Upper', mean: 76, std: 2 }
            ]
          }
        ]
      }
    }
  };

  function applyFigureExample(type = elements.figureType.value) {
    const example = figureExamples[type];
    elements.figureTitle.value = example.fields.title;
    elements.figureCaption.value = example.fields.caption;
    elements.figureXLabel.value = example.fields.xLabel;
    elements.figureYLabel.value = example.fields.yLabel;
    elements.figureXDescription.value = example.fields.xDescription;
    elements.figureYDescription.value = example.fields.yDescription;
    elements.figureAnimated.checked = true;
    elements.figureData.value = JSON.stringify(example.data, null, 2);
    elements.figureDataHelp.textContent = example.help;
    elements.figureBuilderError.hidden = true;
    elements.figureBuilder.classList.toggle('is-carousel-builder', type === 'carousel');
  }

  function findFigureAtCursor() {
    const cursor = elements.body.selectionStart;
    const pattern = /```interactive-figure\n([\s\S]*?)\n```/g;
    let match;
    while ((match = pattern.exec(elements.body.value))) {
      const end = match.index + match[0].length;
      if (cursor >= match.index && cursor <= end) return { start: match.index, end, source: match[1] };
    }
    return null;
  }

  function loadFigureConfig(config) {
    const type = figureExamples[config.type] ? config.type : 'line';
    const example = figureExamples[type];
    elements.figureType.value = type;
    elements.figureBuilder.classList.toggle('is-carousel-builder', type === 'carousel');
    elements.figureDataHelp.textContent = example.help;
    elements.figureBuilderError.hidden = true;
    if (type === 'carousel') {
      const data = { ...config };
      delete data.type;
      elements.figureData.value = JSON.stringify(data, null, 2);
      return;
    }
    elements.figureAnimated.checked = config.animated !== false;
    elements.figureTitle.value = config.title || example.fields.title;
    elements.figureCaption.value = config.caption || '';
    elements.figureXLabel.value = config.xLabel || example.fields.xLabel;
    elements.figureYLabel.value = config.yLabel || example.fields.yLabel;
    elements.figureXDescription.value = config.xDescription || '';
    elements.figureYDescription.value = config.yDescription || '';
    const data = { ...config };
    ['type', 'animated', 'title', 'caption', 'xLabel', 'yLabel', 'xDescription', 'yDescription'].forEach(key => delete data[key]);
    elements.figureData.value = JSON.stringify(data, null, 2);
  }

  function buildFigureConfig() {
    const data = JSON.parse(elements.figureData.value);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Data and options must be a JSON object.');
    const type = elements.figureType.value;
    if (type === 'carousel') {
      if (!Array.isArray(data.figures) || !data.figures.length) throw new Error('A swipeable group needs a non-empty figures array.');
      return { ...data, type: 'carousel' };
    }
    return {
      ...data,
      type,
      animated: elements.figureAnimated.checked,
      title: elements.figureTitle.value.trim() || 'Untitled figure',
      caption: elements.figureCaption.value.trim(),
      xLabel: elements.figureXLabel.value.trim() || 'x',
      yLabel: elements.figureYLabel.value.trim() || 'y',
      xDescription: elements.figureXDescription.value.trim(),
      yDescription: elements.figureYDescription.value.trim()
    };
  }

  function insertFigureConfig(config) {
    const textarea = elements.body;
    const start = editingFigureRange?.start ?? textarea.selectionStart;
    const end = editingFigureRange?.end ?? textarea.selectionEnd;
    const before = start > 0 && !textarea.value.slice(0, start).endsWith('\n\n') ? '\n\n' : '';
    const after = end < textarea.value.length && !textarea.value.slice(end).startsWith('\n\n') ? '\n\n' : '';
    const block = `${before}\`\`\`interactive-figure\n${JSON.stringify(config, null, 2)}\n\`\`\`${after}`;
    textarea.setRangeText(block, start, end, 'end');
    editingFigureRange = null;
    textarea.focus();
    updatePreview();
    persistWorkingCopy();
  }

  async function copyText(value) {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement('textarea');
    textarea.value = value;
    textarea.setAttribute('readonly', '');
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const copied = document.execCommand('copy');
    textarea.remove();
    if (!copied) throw new Error('Copy command failed');
  }

  function wrapSelection(before, after = before, placeholder = '') {
    const textarea = elements.body;
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const selected = textarea.value.slice(start, end) || placeholder;
    textarea.setRangeText(`${before}${selected}${after}`, start, end, 'select');
    textarea.focus();
    updatePreview();
    persistWorkingCopy();
  }

  document.querySelectorAll('[data-format]').forEach(button => {
    button.addEventListener('click', () => {
      const format = button.dataset.format;
      if (format === 'heading') wrapSelection('## ', '', 'Section heading');
      if (format === 'bold') wrapSelection('**', '**', 'important text');
      if (format === 'italic') wrapSelection('*', '*', 'emphasized text');
      if (format === 'link') wrapSelection('[', '](https://example.com)', 'link text');
      if (format === 'code') wrapSelection('`', '`', 'code');
      if (format === 'quote') wrapSelection('> ', '', 'Quoted text');
      if (format === 'list') wrapSelection('- ', '', 'List item');
      if (format === 'image') wrapSelection('![', '](../assets/figure.png)', 'Figure caption');
    });
  });

  elements.openFigureBuilder.addEventListener('click', () => {
    const existingFigure = findFigureAtCursor();
    editingFigureRange = existingFigure ? { start: existingFigure.start, end: existingFigure.end } : null;
    if (existingFigure) {
      try {
        loadFigureConfig(JSON.parse(existingFigure.source));
      } catch {
        applyFigureExample('line');
        elements.figureBuilderError.textContent = 'The figure under the cursor contains invalid JSON. Inserting will replace it with a valid figure.';
        elements.figureBuilderError.hidden = false;
      }
    } else {
      applyFigureExample(elements.figureType.value || 'line');
    }
    elements.submitFigureBuilder.textContent = existingFigure ? 'Update figure' : 'Insert figure';
    elements.figureBuilder.showModal();
  });
  elements.closeFigureBuilder.addEventListener('click', () => elements.figureBuilder.close());
  elements.cancelFigureBuilder.addEventListener('click', () => elements.figureBuilder.close());
  elements.resetFigureExample.addEventListener('click', () => applyFigureExample());
  elements.figureType.addEventListener('change', () => applyFigureExample(elements.figureType.value));
  elements.figureBuilder.addEventListener('click', event => {
    if (event.target === elements.figureBuilder) elements.figureBuilder.close();
  });
  elements.figureBuilderForm.addEventListener('submit', event => {
    event.preventDefault();
    try {
      insertFigureConfig(buildFigureConfig());
      elements.figureBuilderError.hidden = true;
      elements.figureBuilder.close();
      showStatus('Interactive figure inserted');
    } catch (error) {
      elements.figureBuilderError.textContent = `Check the figure JSON: ${error.message}`;
      elements.figureBuilderError.hidden = false;
    }
  });

  [elements.title, elements.slug, elements.date, elements.summary, elements.authors, elements.affiliation, elements.body].forEach(element => {
    element.addEventListener('input', () => {
      if (element === elements.title && !slugWasEdited) elements.slug.value = slugify(elements.title.value);
      if (element === elements.slug) slugWasEdited = true;
      updatePreview();
      persistWorkingCopy();
    });
  });

  elements.newDraft.addEventListener('click', () => {
    setPostData({ date: new Date().toISOString().slice(0, 10), authors: 'Arda Uzunoğlu', affiliation: 'Johns Hopkins University' });
    activeDraftId = '';
    elements.draftList.value = '';
    slugWasEdited = false;
    showStatus('New draft');
  });
  elements.saveDraft.addEventListener('click', saveDraft);
  elements.download.addEventListener('click', downloadPost);
  elements.publish.addEventListener('click', publishPost);
  elements.unlockPublishing.addEventListener('click', () => {
    elements.publisherLoginError.hidden = true;
    elements.publisherPassword.value = '';
    elements.publisherLogin.showModal();
    elements.publisherPassword.focus();
  });
  elements.closePublisherLogin.addEventListener('click', () => elements.publisherLogin.close());
  elements.cancelPublisherLogin.addEventListener('click', () => elements.publisherLogin.close());
  elements.publisherLogin.addEventListener('click', event => {
    if (event.target === elements.publisherLogin) elements.publisherLogin.close();
  });
  elements.publisherLoginForm.addEventListener('submit', async event => {
    event.preventDefault();
    elements.publisherLoginError.hidden = true;
    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ password: elements.publisherPassword.value })
      });
      const result = await response.json();
      if (!response.ok || !result.ok) throw new Error(result.message || 'Could not unlock publishing.');
      elements.publisherPassword.value = '';
      elements.publisherLogin.close();
      setPublisherState(true, true);
      showStatus('Publishing unlocked');
    } catch (error) {
      elements.publisherLoginError.textContent = error.message || 'Could not unlock publishing.';
      elements.publisherLoginError.hidden = false;
      elements.publisherPassword.select();
    }
  });
  elements.lockPublishing.addEventListener('click', async () => {
    try { await fetch('/api/auth/logout', { method: 'POST' }); } catch { /* The controls still lock locally. */ }
    setPublisherState(true, false);
    showStatus('Publishing locked');
  });
  elements.draftList.addEventListener('change', () => {
    const draft = getDrafts().find(item => item.id === elements.draftList.value);
    if (draft) setPostData(draft);
  });
  elements.copyIndexEntry.addEventListener('click', async () => {
    const post = getPostData();
    const error = validateForExport(post);
    if (error) {
      showStatus(error);
      return;
    }
    try {
      await copyText(createIndexEntry(post));
      showStatus('Blog index entry copied');
    } catch {
      showStatus('Could not copy; add the blog entry manually.');
    }
  });

  const savedWorkingCopy = (() => {
    try { return JSON.parse(localStorage.getItem(WORKING_KEY)); }
    catch { return null; }
  })();
  refreshDraftList();
  applyFigureExample('line');
  setPostData(savedWorkingCopy || {
    date: new Date().toISOString().slice(0, 10),
    authors: 'Arda Uzunoğlu',
    affiliation: 'Johns Hopkins University',
    body: 'Start with the central claim or question.\n\n## First section\n\nDevelop the idea here.'
  });
  checkPublisherStatus();
})();
