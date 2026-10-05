(() => {
  const SVG_NS = 'http://www.w3.org/2000/svg';
  const WIDTH = 720;
  const HEIGHT = 370;
  const COLORS = ['#275f9f', '#b16d4b', '#558a6a', '#805b9d', '#b28a35', '#477f86'];
  const observed = new WeakSet();
  const registrations = new WeakMap();

  const svgElement = (tag, attributes = {}) => {
    const element = document.createElementNS(SVG_NS, tag);
    Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, value));
    return element;
  };

  const addSvgText = (parent, text, attributes = {}) => {
    const element = svgElement('text', attributes);
    element.textContent = text;
    parent.append(element);
    return element;
  };

  const number = (value, fallback = 0) => Number.isFinite(Number(value)) ? Number(value) : fallback;
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const legendLayout = (items, startX, availableWidth) => {
    const gap = 10;
    const rowHeight = 19;
    const positions = [];
    let x = startX;
    let row = 0;
    items.forEach((item, index) => {
      const label = item.name || `Series ${index + 1}`;
      const width = clamp(34 + (label.length * 5.2), 64, Math.min(190, availableWidth));
      if (x > startX && x + width > startX + availableWidth) {
        row += 1;
        x = startX;
      }
      positions.push({ x, y: 18 + (row * rowHeight), width, label });
      x += width + gap;
    });
    return { positions, rows: row + 1, rowHeight };
  };
  const formatNumber = value => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric)) return String(value);
    return Math.abs(numeric) >= 100 || Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, '').replace(/\.$/, '');
  };

  function extent(values, configuredMin, configuredMax, includeZero = false) {
    const finite = values.map(Number).filter(Number.isFinite);
    let min = Number.isFinite(Number(configuredMin)) ? Number(configuredMin) : Math.min(...finite);
    let max = Number.isFinite(Number(configuredMax)) ? Number(configuredMax) : Math.max(...finite);
    if (!finite.length && !Number.isFinite(min)) min = 0;
    if (!finite.length && !Number.isFinite(max)) max = 1;
    if (includeZero && !Number.isFinite(Number(configuredMin))) min = Math.min(0, min);
    if (includeZero && !Number.isFinite(Number(configuredMax))) max = Math.max(0, max);
    if (min === max) {
      const padding = Math.abs(min || 1) * .15;
      min -= padding;
      max += padding;
    }
    const padding = (max - min) * .08;
    if (!Number.isFinite(Number(configuredMin))) min -= padding;
    if (!Number.isFinite(Number(configuredMax))) max += padding;
    return [min, max];
  }

  function parseConfig(host) {
    try {
      return JSON.parse(host.getAttribute('data-figure-config') || '{}');
    } catch {
      return null;
    }
  }

  function icon(name) {
    const paths = {
      replay: '<path d="M18 8a7 7 0 1 0 1.2 7.9"/><path d="M18 3v5h-5"/>',
      pause: '<path d="M9 7v10M15 7v10"/>',
      play: '<path class="play-fill" d="M9 6.5 18 12l-9 5.5z"/>',
      fast: '<path class="play-fill" d="m6 7 7 5-7 5zm7 0 7 5-7 5z"/>'
    };
    return `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name]}</svg>`;
  }

  function createPlayback() {
    const controls = document.createElement('div');
    controls.className = 'chart-playback';
    controls.setAttribute('aria-label', 'Animation controls');
    const buttons = {};
    [
      ['replay', 'Replay animation'],
      ['pause', 'Pause animation'],
      ['play', 'Play animation'],
      ['fast', 'Play animation faster']
    ].forEach(([name, label]) => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `${name}-button`;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-pressed', 'false');
      button.innerHTML = icon(name);
      controls.append(button);
      buttons[name] = button;
    });
    const setActive = name => {
      ['pause', 'play', 'fast'].forEach(key => {
        const active = key === name;
        buttons[key].classList.toggle('is-active', active);
        buttons[key].setAttribute('aria-pressed', String(active));
      });
    };
    return { controls, buttons, setActive };
  }

  function createShell(host, config, ariaLabel) {
    const isCarouselFigure = host.classList.contains('carousel-figure');
    host.replaceChildren();
    host.className = 'line-chart-lab generated-scientific-figure';
    if (isCarouselFigure) host.classList.add('carousel-figure');
    const wrap = document.createElement('div');
    wrap.className = 'chart-wrap';
    const svg = svgElement('svg', {
      class: 'scientific-chart generated-chart',
      viewBox: `0 0 ${WIDTH} ${HEIGHT}`,
      preserveAspectRatio: 'xMidYMid meet',
      role: 'img',
      'aria-label': ariaLabel
    });
    const tooltip = document.createElement('div');
    tooltip.className = 'chart-tooltip';
    tooltip.setAttribute('role', 'tooltip');
    tooltip.hidden = true;
    wrap.append(svg, tooltip);

    const footer = document.createElement('div');
    footer.className = 'figure-footer';
    const caption = document.createElement('figcaption');
    caption.className = 'figure-caption';
    const title = document.createElement('span');
    title.className = 'figure-title';
    title.textContent = config.title || 'Untitled figure';
    caption.append(title);
    if (config.caption) caption.append(document.createTextNode(` ${config.caption}`));
    footer.append(caption);
    host.append(wrap, footer);
    return { figure: host, wrap, svg, tooltip, footer };
  }

  function bindTooltip(shell, anchor, title, details = []) {
    const show = () => {
      shell.tooltip.replaceChildren();
      const strong = document.createElement('strong');
      strong.textContent = title;
      shell.tooltip.append(strong);
      details.filter(Boolean).forEach(detail => {
        const line = document.createElement('span');
        line.textContent = detail;
        shell.tooltip.append(line);
      });
      shell.tooltip.hidden = false;
      shell.tooltip.style.left = '-9999px';
      shell.tooltip.style.top = '-9999px';
      const chartBounds = shell.svg.getBoundingClientRect();
      const anchorBounds = anchor.getBoundingClientRect();
      const tooltipWidth = shell.tooltip.offsetWidth;
      const tooltipHeight = shell.tooltip.offsetHeight;
      const rect = {
        left: anchorBounds.left - chartBounds.left,
        right: anchorBounds.right - chartBounds.left,
        top: anchorBounds.top - chartBounds.top,
        bottom: anchorBounds.bottom - chartBounds.top
      };
      const candidates = [
        { left: rect.left + (rect.right - rect.left - tooltipWidth) / 2, top: rect.top - tooltipHeight - 10 },
        { left: rect.right + 10, top: rect.top + (rect.bottom - rect.top - tooltipHeight) / 2 },
        { left: rect.left + (rect.right - rect.left - tooltipWidth) / 2, top: rect.bottom + 10 },
        { left: rect.left - tooltipWidth - 10, top: rect.top + (rect.bottom - rect.top - tooltipHeight) / 2 }
      ].map(candidate => ({
        left: clamp(candidate.left, 6, chartBounds.width - tooltipWidth - 6),
        top: clamp(candidate.top, 6, chartBounds.height - tooltipHeight - 6)
      }));
      const blockers = [...shell.svg.querySelectorAll('text, circle, .interactive-mark')]
        .filter(element => element !== anchor)
        .map(element => {
          const bounds = element.getBoundingClientRect();
          return {
            left: bounds.left - chartBounds.left - 3,
            right: bounds.right - chartBounds.left + 3,
            top: bounds.top - chartBounds.top - 3,
            bottom: bounds.bottom - chartBounds.top + 3
          };
        });
      const collisions = candidate => blockers.filter(blocker => {
        const candidateRect = { left: candidate.left, right: candidate.left + tooltipWidth, top: candidate.top, bottom: candidate.top + tooltipHeight };
        return candidateRect.left < blocker.right && candidateRect.right > blocker.left && candidateRect.top < blocker.bottom && candidateRect.bottom > blocker.top;
      }).length;
      const best = candidates.map(candidate => ({ candidate, collisions: collisions(candidate) }))
        .reduce((least, current) => current.collisions < least.collisions ? current : least);
      shell.tooltip.style.left = `${best.candidate.left}px`;
      shell.tooltip.style.top = `${best.candidate.top}px`;
    };
    const hide = () => { shell.tooltip.hidden = true; };
    anchor.setAttribute('tabindex', '0');
    anchor.setAttribute('role', 'img');
    anchor.setAttribute('aria-label', [title, ...details].filter(Boolean).join('. '));
    anchor.addEventListener('pointerenter', show);
    anchor.addEventListener('pointerleave', hide);
    anchor.addEventListener('focus', show);
    anchor.addEventListener('blur', hide);
  }

  function addAxisTitle(shell, text, description, attributes) {
    const label = addSvgText(shell.svg, text, { ...attributes, class: 'axis-title axis-title-annotated' });
    bindTooltip(shell, label, text, description ? [description] : []);
  }

  function addNumericAxes(shell, options) {
    const {
      margin, xMin, xMax, yMin, yMax, xLabel, xDescription, yLabel, yDescription,
      xTicks, fixedYLines = [], xScaleType = 'linear', xTickFormatter = formatNumber,
      yTickFormatter = formatNumber
    } = options;
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const transformX = value => xScaleType === 'log2' ? Math.log2(number(value)) : number(value);
    const transformedXMin = transformX(xMin);
    const transformedXMax = transformX(xMax);
    const xScale = value => margin.left + ((transformX(value) - transformedXMin) / (transformedXMax - transformedXMin)) * plotWidth;
    const yScale = value => margin.top + ((yMax - number(value)) / (yMax - yMin)) * plotHeight;
    shell.svg.append(svgElement('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, class: 'chart-frame' }));
    for (let index = 0; index <= 4; index += 1) {
      const value = yMin + ((yMax - yMin) * index / 4);
      const y = yScale(value);
      shell.svg.append(svgElement('line', { x1: margin.left, y1: y, x2: WIDTH - margin.right, y2: y, class: 'grid-line' }));
      addSvgText(shell.svg, yTickFormatter(value), { x: margin.left - 11, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    }
    const ticks = xTicks?.length ? xTicks : Array.from({ length: 6 }, (_, index) => xMin + ((xMax - xMin) * index / 5));
    ticks.forEach(value => {
      const x = xScale(value);
      shell.svg.append(svgElement('line', { x1: x, y1: HEIGHT - margin.bottom, x2: x, y2: HEIGHT - margin.bottom + 5, class: 'axis-tick' }));
      addSvgText(shell.svg, xTickFormatter(value), { x, y: HEIGHT - margin.bottom + 25, 'text-anchor': 'middle', class: 'axis-label' });
    });
    fixedYLines.forEach(item => {
      const value = number(item.value, NaN);
      if (!Number.isFinite(value) || value < yMin || value > yMax) return;
      const y = yScale(value);
      shell.svg.append(svgElement('line', { x1: margin.left, y1: y, x2: WIDTH - margin.right, y2: y, class: 'fixed-value-line' }));
      addSvgText(shell.svg, item.label || yTickFormatter(value), { x: WIDTH - margin.right - 8, y: y - 7, 'text-anchor': 'end', class: 'fixed-value-label' });
    });
    addAxisTitle(shell, xLabel || 'x', xDescription || '', { x: margin.left + plotWidth / 2, y: HEIGHT - 12, 'text-anchor': 'middle' });
    addAxisTitle(shell, yLabel || 'y', yDescription || '', { x: 18, y: margin.top + plotHeight / 2, transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`, 'text-anchor': 'middle' });
    return { xScale, yScale, plotWidth, plotHeight };
  }

  function attachStepPlayback(shell, total, render, delay = 550) {
    const playback = createPlayback();
    shell.footer.append(playback.controls);
    let count = 0;
    let paused = true;
    let timer = 0;
    let currentDelay = delay;
    const schedule = () => {
      window.clearTimeout(timer);
      if (paused || count >= total) return;
      timer = window.setTimeout(() => {
        count += 1;
        render(count);
        schedule();
      }, currentDelay);
    };
    const start = (reset = false, fast = false) => {
      if (reset || count >= total) {
        count = 0;
        render(0);
      }
      paused = false;
      currentDelay = fast ? Math.max(80, delay * .28) : delay;
      playback.setActive(fast ? 'fast' : 'play');
      schedule();
    };
    playback.buttons.replay.addEventListener('click', () => start(true, false));
    playback.buttons.pause.addEventListener('click', () => {
      paused = true;
      window.clearTimeout(timer);
      playback.setActive('pause');
    });
    playback.buttons.play.addEventListener('click', () => start(false, false));
    playback.buttons.fast.addEventListener('click', () => start(false, true));
    playback.setActive('play');
    render(0);
    return { restart: () => start(true, false), prepare: () => { paused = true; window.clearTimeout(timer); count = 0; render(0); playback.setActive('play'); } };
  }

  function attachProgressPlayback(shell, render, duration = 1200) {
    const playback = createPlayback();
    shell.footer.append(playback.controls);
    let frame = 0;
    let elapsed = 0;
    let startedAt = 0;
    let paused = true;
    let speed = 1;
    const draw = now => {
      if (!startedAt) startedAt = now;
      const current = elapsed + ((now - startedAt) * speed);
      render(clamp(current / duration, 0, 1));
      if (current < duration && !paused) frame = window.requestAnimationFrame(draw);
      else if (current >= duration) elapsed = duration;
    };
    const start = (reset = false, fast = false) => {
      window.cancelAnimationFrame(frame);
      if (reset || elapsed >= duration) elapsed = 0;
      speed = fast ? 2.8 : 1;
      paused = false;
      startedAt = 0;
      playback.setActive(fast ? 'fast' : 'play');
      frame = window.requestAnimationFrame(draw);
    };
    playback.buttons.replay.addEventListener('click', () => start(true, false));
    playback.buttons.pause.addEventListener('click', () => {
      if (!paused && startedAt) elapsed = Math.min(duration, elapsed + ((performance.now() - startedAt) * speed));
      paused = true;
      window.cancelAnimationFrame(frame);
      playback.setActive('pause');
    });
    playback.buttons.play.addEventListener('click', () => start(false, false));
    playback.buttons.fast.addEventListener('click', () => start(false, true));
    playback.setActive('play');
    render(0);
    return { restart: () => start(true, false), prepare: () => { paused = true; window.cancelAnimationFrame(frame); elapsed = 0; render(0); playback.setActive('play'); } };
  }

  function renderLine(host, config) {
    const series = Array.isArray(config.series) ? config.series.filter(item => Array.isArray(item.values) && item.values.length) : [];
    const shell = createShell(host, config, config.ariaLabel || `Line chart: ${config.title || 'interactive figure'}`);
    if (!series.length) return renderError(host, 'A line figure needs at least one series with values.');
    const allPoints = series.flatMap(item => item.values);
    const xValues = allPoints.map(point => number(point.x, NaN)).filter(Number.isFinite);
    if (config.xScale === 'log2' && xValues.some(value => value <= 0)) return renderError(host, 'A log₂ x-axis requires positive x values.');
    const valueFormatter = config.valueFormat === 'percent'
      ? value => `${(number(value) * 100).toFixed(number(config.decimals, 1))}%`
      : formatNumber;
    const xTickLabels = config.xTickLabels && typeof config.xTickLabels === 'object' ? config.xTickLabels : {};
    const xFormatter = value => xTickLabels[String(value)] || formatNumber(value);
    const errorLabel = config.errorLabel || 'std';
    const metricLabel = config.metricLabel || 'mean';
    const yValues = allPoints.flatMap(point => {
      const mean = number(point.mean ?? point.y, NaN);
      const error = Math.abs(number(point.error ?? point.std, 0));
      return [mean - error, mean + error];
    }).filter(Number.isFinite);
    const fixedYLines = Array.isArray(config.fixedYLines) ? config.fixedYLines : [];
    yValues.push(...fixedYLines.map(item => number(item.value, NaN)).filter(Number.isFinite));
    const [xMin, xMax] = extent(xValues, config.xMin, config.xMax);
    const [yMin, yMax] = extent(yValues, config.yMin, config.yMax);
    const margin = { top: 24, right: 10, bottom: 58, left: 62 + Math.max(0, number(config.yLabelGap, 0)) };
    const lineLegend = legendLayout(series, margin.left, WIDTH - margin.left - margin.right);
    margin.top = 24 + (lineLegend.rows * lineLegend.rowHeight);
    const uniqueX = [...new Set(xValues)].sort((a, b) => a - b);
    const axes = addNumericAxes(shell, {
      margin, xMin, xMax, yMin, yMax, xLabel: config.xLabel, xDescription: config.xDescription,
      yLabel: config.yLabel, yDescription: config.yDescription,
      xTicks: uniqueX.length <= 10 ? uniqueX : undefined, fixedYLines,
      xScaleType: config.xScale, xTickFormatter: xFormatter, yTickFormatter: valueFormatter
    });
    const legend = svgElement('g', { class: 'generated-legend' });
    shell.svg.append(legend);
    series.forEach((item, index) => {
      const color = item.color || COLORS[index % COLORS.length];
      const position = lineLegend.positions[index];
      const legendX = position.x;
      const y = position.y;
      const group = svgElement('g', { class: 'legend-item interactive-mark' });
      group.append(svgElement('rect', { x: legendX + 1, y: y - 11, width: position.width, height: 17, class: 'legend-hit-area' }));
      const swatch = svgElement('line', { x1: legendX + 7, y1: y, x2: legendX + 28, y2: y, class: 'legend-swatch' });
      swatch.style.stroke = color;
      group.append(swatch);
      const label = addSvgText(group, item.name || `Series ${index + 1}`, { x: legendX + 35, y: y + 4, class: 'series-label', fill: color });
      legend.append(group);
      bindTooltip(shell, group, item.name || `Series ${index + 1}`, item.description ? [item.description] : []);
      label.style.fill = color;
    });
    const layer = svgElement('g', { class: 'generated-data-layer' });
    shell.svg.append(layer);
    const maxPoints = Math.max(...series.map(item => item.values.length));
    const draw = count => {
      layer.replaceChildren();
      series.forEach((item, seriesIndex) => {
        const color = item.color || COLORS[seriesIndex % COLORS.length];
        const visible = item.values.slice(0, count).map(point => ({
          x: number(point.x),
          mean: number(point.mean ?? point.y),
          error: point.error == null && point.std == null ? null : Math.abs(number(point.error ?? point.std)),
          n: point.n,
          description: point.description || ''
        }));
        const withError = visible.filter(point => point.error != null);
        if (withError.length > 1 && config.showBands !== false) {
          const upper = withError.map(point => `${axes.xScale(point.x)} ${axes.yScale(point.mean + point.error)}`).join(' L ');
          const lower = [...withError].reverse().map(point => `${axes.xScale(point.x)} ${axes.yScale(point.mean - point.error)}`).join(' L ');
          const area = svgElement('path', { d: `M ${upper} L ${lower} Z`, class: 'data-area', opacity: '.11' });
          area.style.fill = color;
          layer.append(area);
        }
        if (visible.length > 1) {
          const line = svgElement('path', { d: visible.map((point, index) => `${index ? 'L' : 'M'} ${axes.xScale(point.x)} ${axes.yScale(point.mean)}`).join(' '), class: 'data-line', 'stroke-dasharray': item.dashed ? '5 4' : 'none' });
          line.style.stroke = color;
          layer.append(line);
        }
        visible.forEach(point => {
          const x = axes.xScale(point.x);
          const y = axes.yScale(point.mean);
          if (point.error != null && config.showErrorBars !== false) {
            const upper = axes.yScale(point.mean + point.error);
            const lower = axes.yScale(point.mean - point.error);
            const whisker = svgElement('g', { class: 'uncertainty-mark' });
            [[x, upper, x, lower], [x - 5, upper, x + 5, upper], [x - 5, lower, x + 5, lower]].forEach(coords => {
              const mark = svgElement('line', { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
              mark.style.stroke = color;
              whisker.append(mark);
            });
            layer.append(whisker);
          }
          const dot = svgElement('circle', { cx: x, cy: y, r: 5.5, class: 'data-point interactive-mark' });
          dot.style.fill = color;
          layer.append(dot);
          bindTooltip(shell, dot, `${item.name || `Series ${seriesIndex + 1}`} · ${config.xLabel || 'x'}=${xFormatter(point.x)}`, [
            `${metricLabel}=${valueFormatter(point.mean)}`,
            point.error == null ? '' : `${errorLabel}=${valueFormatter(point.error)}`,
            point.n == null ? '' : `n=${point.n}`,
            point.description
          ]);
        });
      });
    };
    if (config.animated === false) {
      draw(maxPoints);
      return { restart: () => draw(maxPoints), prepare: () => draw(maxPoints) };
    }
    return attachStepPlayback(shell, maxPoints, draw, number(config.revealDelay, 600));
  }

  function renderScatter(host, config) {
    const points = Array.isArray(config.points) ? config.points : [];
    const shell = createShell(host, config, config.ariaLabel || `Scatter plot: ${config.title || 'interactive figure'}`);
    if (!points.length) return renderError(host, 'A scatter figure needs a points array.');
    const xValues = points.map(point => number(point.x, NaN)).filter(Number.isFinite);
    const yValues = points.map(point => number(point.y, NaN)).filter(Number.isFinite);
    const fixedYLines = Array.isArray(config.fixedYLines) ? config.fixedYLines : [];
    yValues.push(...fixedYLines.map(item => number(item.value, NaN)).filter(Number.isFinite));
    const [xMin, xMax] = extent(xValues, config.xMin, config.xMax);
    const [yMin, yMax] = extent(yValues, config.yMin, config.yMax);
    const margin = { top: 24, right: 10, bottom: 58, left: 62 };
    const axes = addNumericAxes(shell, { margin, xMin, xMax, yMin, yMax, xLabel: config.xLabel, xDescription: config.xDescription, yLabel: config.yLabel, yDescription: config.yDescription, fixedYLines });
    const layer = svgElement('g');
    shell.svg.append(layer);
    const draw = count => {
      layer.replaceChildren();
      points.slice(0, count).forEach((point, index) => {
        const dot = svgElement('circle', { cx: axes.xScale(point.x), cy: axes.yScale(point.y), r: number(point.size, 6), class: 'scatter-mark interactive-mark' });
        dot.style.fill = point.color || COLORS[index % COLORS.length];
        dot.style.stroke = point.color || COLORS[index % COLORS.length];
        layer.append(dot);
        bindTooltip(shell, dot, point.label || `Point ${index + 1}`, [`${config.xLabel || 'x'}  ${formatNumber(point.x)}`, `${config.yLabel || 'y'}  ${formatNumber(point.y)}`, point.description || '']);
      });
    };
    if (config.animated === false) {
      draw(points.length);
      return { restart: () => draw(points.length), prepare: () => draw(points.length) };
    }
    return attachStepPlayback(shell, points.length, draw, number(config.revealDelay, 220));
  }

  function renderBar(host, config) {
    const series = Array.isArray(config.series) ? config.series.filter(item => Array.isArray(item.values) && item.values.length) : [];
    const legacyBars = Array.isArray(config.bars) ? config.bars : [];
    const shell = createShell(host, config, config.ariaLabel || `Bar chart: ${config.title || 'interactive figure'}`);
    if (!series.length && !legacyBars.length) return renderError(host, 'A bar figure needs a bars array or grouped series.');
    const grouped = series.length > 0;
    const valueFormatter = config.valueFormat === 'percent'
      ? value => `${(number(value) * 100).toFixed(number(config.decimals, 1))}%`
      : formatNumber;
    const errorLabel = config.errorLabel || (grouped ? 'error' : 'std');
    const metricLabel = config.metricLabel || 'mean';
    const bars = grouped
      ? series.flatMap((seriesItem, seriesIndex) => seriesItem.values.map(value => ({
        ...value,
        category: value.category ?? value.label,
        seriesName: seriesItem.name || `Series ${seriesIndex + 1}`,
        seriesDescription: seriesItem.description || '',
        seriesIndex,
        color: value.color || seriesItem.color
      })))
      : legacyBars.map((item, index) => ({ ...item, category: item.category ?? item.label, seriesName: '', seriesIndex: index }));
    const categories = Array.isArray(config.categories) && config.categories.length
      ? config.categories
      : [...new Set(bars.map((item, index) => item.category || `Bar ${index + 1}`))];
    const fixedYLines = Array.isArray(config.fixedYLines) ? config.fixedYLines : [];
    const yValues = bars.flatMap(item => {
      const mean = number(item.mean);
      const error = Math.abs(number(item.error ?? item.std, 0));
      return [mean - error, mean + error];
    });
    yValues.push(...fixedYLines.map(item => number(item.value, NaN)).filter(Number.isFinite));
    const [yMin, yMax] = extent(yValues, config.yMin ?? 0, config.yMax, true);
    const yLabelGap = Math.max(0, number(config.yLabelGap, 0));
    const margin = { top: 24, right: 10, bottom: 66, left: 62 + yLabelGap };
    const barLegend = grouped ? legendLayout(series, margin.left, WIDTH - margin.left - margin.right) : null;
    if (barLegend) margin.top = 28 + (barLegend.rows * barLegend.rowHeight);
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const yScale = value => margin.top + ((yMax - number(value)) / (yMax - yMin)) * plotHeight;
    shell.svg.append(svgElement('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, class: 'chart-frame' }));
    for (let index = 0; index <= 4; index += 1) {
      const value = yMin + ((yMax - yMin) * index / 4);
      const y = yScale(value);
      shell.svg.append(svgElement('line', { x1: margin.left, y1: y, x2: WIDTH - margin.right, y2: y, class: 'grid-line' }));
      addSvgText(shell.svg, valueFormatter(value), { x: margin.left - 11, y: y + 4, 'text-anchor': 'end', class: 'axis-label' });
    }
    fixedYLines.forEach(item => {
      const y = yScale(item.value);
      shell.svg.append(svgElement('line', { x1: margin.left, y1: y, x2: WIDTH - margin.right, y2: y, class: 'fixed-value-line' }));
      addSvgText(shell.svg, item.label || valueFormatter(item.value), { x: WIDTH - margin.right - 8, y: y - 7, 'text-anchor': 'end', class: 'fixed-value-label' });
    });
    addAxisTitle(shell, config.xLabel || 'Condition', config.xDescription || '', { x: margin.left + plotWidth / 2, y: HEIGHT - 12, 'text-anchor': 'middle' });
    addAxisTitle(shell, config.yLabel || 'Value', config.yDescription || '', { x: 18, y: margin.top + plotHeight / 2, transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`, 'text-anchor': 'middle' });
    if (grouped) {
      series.forEach((seriesItem, index) => {
        const color = seriesItem.color || COLORS[index % COLORS.length];
        const position = barLegend.positions[index];
        const legendX = position.x;
        const legendY = position.y;
        const legend = svgElement('g', { class: 'legend-item interactive-mark' });
        legend.append(svgElement('rect', { x: legendX, y: legendY - 11, width: position.width, height: 17, class: 'legend-hit-area' }));
        const swatch = svgElement('rect', { x: legendX + 4, y: legendY - 7, width: 18, height: 8, class: 'legend-swatch' });
        swatch.style.fill = color;
        legend.append(swatch);
        const label = addSvgText(legend, position.label, { x: legendX + 29, y: legendY + 2, class: 'series-label' });
        label.style.fill = color;
        shell.svg.append(legend);
        bindTooltip(shell, legend, seriesItem.name || `Series ${index + 1}`, seriesItem.description ? [seriesItem.description] : []);
      });
    }
    const categorySlot = plotWidth / categories.length;
    const groupWidth = categorySlot * (grouped ? .72 : .62);
    const barsPerCategory = grouped ? series.length : 1;
    const subSlot = groupWidth / barsPerCategory;
    const barWidth = Math.min(88, subSlot * .84);
    const baseline = yScale(Math.max(0, yMin));
    const layer = svgElement('g');
    shell.svg.append(layer);
    categories.forEach((category, index) => {
      addSvgText(shell.svg, category, {
        x: margin.left + (categorySlot * index) + (categorySlot / 2),
        y: HEIGHT - margin.bottom + 26,
        'text-anchor': 'middle',
        class: 'category-label'
      });
    });
    const items = bars.map((item, index) => {
      const categoryIndex = Math.max(0, categories.indexOf(item.category));
      const seriesIndex = grouped ? item.seriesIndex : 0;
      const x = margin.left + (categorySlot * categoryIndex) + ((categorySlot - groupWidth) / 2) + (subSlot * seriesIndex) + ((subSlot - barWidth) / 2);
      const mean = number(item.mean);
      const error = Math.abs(number(item.error ?? item.std, 0));
      const group = svgElement('g', { class: 'bar-mark interactive-mark' });
      const color = item.color || COLORS[(grouped ? item.seriesIndex : index) % COLORS.length];
      const errorBarColor = item.errorBarColor || config.errorBarColor || color;
      const rect = svgElement('rect', { x, y: baseline, width: barWidth, height: 0, class: 'bar-fill' });
      rect.style.fill = color;
      const whisker = svgElement('g', { class: 'bar-error' });
      const center = x + barWidth / 2;
      const upper = yScale(mean + error);
      const lower = yScale(mean - error);
      [[center, baseline, center, baseline], [center - 8, baseline, center + 8, baseline], [center - 8, baseline, center + 8, baseline]].forEach(coords => {
        const mark = svgElement('line', { x1: coords[0], y1: coords[1], x2: coords[2], y2: coords[3] });
        mark.style.stroke = errorBarColor;
        whisker.append(mark);
      });
      group.append(rect, whisker);
      layer.append(group);
      const title = grouped ? `${item.category} · ${item.seriesName}` : (item.label || `Bar ${index + 1}`);
      const sampleSize = item.n == null ? '' : `n=${item.n}`;
      bindTooltip(shell, group, title, [`${metricLabel}=${valueFormatter(mean)}`, item.error == null && item.std == null ? '' : `${errorLabel}=${valueFormatter(error)}`, sampleSize, item.description || '']);
      return { group, rect, whisker: [...whisker.querySelectorAll('line')], x, mean, error, center, upper, lower };
    });
    const draw = globalProgress => {
      items.forEach((item, index) => {
        const progress = clamp((globalProgress * 1.35) - (index * .09), 0, 1);
        const eased = 1 - Math.pow(1 - progress, 3);
        const targetY = yScale(item.mean);
        item.rect.setAttribute('y', baseline + ((targetY - baseline) * eased));
        item.rect.setAttribute('height', Math.abs(baseline - targetY) * eased);
        const positions = [[baseline + ((item.upper - baseline) * eased), baseline + ((item.lower - baseline) * eased)], [baseline + ((item.upper - baseline) * eased), baseline + ((item.upper - baseline) * eased)], [baseline + ((item.lower - baseline) * eased), baseline + ((item.lower - baseline) * eased)]];
        item.whisker.forEach((line, lineIndex) => {
          line.setAttribute('y1', positions[lineIndex][0]);
          line.setAttribute('y2', positions[lineIndex][1]);
        });
      });
    };
    if (config.animated === false) {
      draw(1);
      return { restart: () => draw(1), prepare: () => draw(1) };
    }
    return attachProgressPlayback(shell, draw, number(config.duration, 1400));
  }

  function renderHeatmap(host, config) {
    const xLabels = Array.isArray(config.xLabels) ? config.xLabels : [];
    const yLabels = Array.isArray(config.yLabels) ? config.yLabels : [];
    const values = Array.isArray(config.values) ? config.values : [];
    const shell = createShell(host, config, config.ariaLabel || `Heatmap: ${config.title || 'interactive figure'}`);
    if (!xLabels.length || !yLabels.length || !values.length) return renderError(host, 'A heatmap needs xLabels, yLabels, and a values matrix.');
    const margin = { top: 38, right: 74, bottom: 66, left: 118 };
    const plotWidth = WIDTH - margin.left - margin.right;
    const plotHeight = HEIGHT - margin.top - margin.bottom;
    const cellWidth = plotWidth / xLabels.length;
    const cellHeight = plotHeight / yLabels.length;
    const flat = values.flat().map(Number).filter(Number.isFinite);
    const min = Math.min(...flat);
    const max = Math.max(...flat);
    const color = value => {
      const ratio = max === min ? .5 : (number(value) - min) / (max - min);
      const lightness = 94 - (ratio * 48);
      return `hsl(211 50% ${lightness}%)`;
    };
    shell.svg.append(svgElement('rect', { x: margin.left, y: margin.top, width: plotWidth, height: plotHeight, class: 'chart-frame' }));
    xLabels.forEach((label, index) => addSvgText(shell.svg, label, { x: margin.left + (index + .5) * cellWidth, y: HEIGHT - margin.bottom + 25, 'text-anchor': 'middle', class: 'category-label' }));
    yLabels.forEach((label, index) => addSvgText(shell.svg, label, { x: margin.left - 12, y: margin.top + (index + .5) * cellHeight + 4, 'text-anchor': 'end', class: 'category-label' }));
    addAxisTitle(shell, config.xLabel || 'Columns', config.xDescription || '', { x: margin.left + plotWidth / 2, y: HEIGHT - 12, 'text-anchor': 'middle' });
    addAxisTitle(shell, config.yLabel || 'Rows', config.yDescription || '', { x: 18, y: margin.top + plotHeight / 2, transform: `rotate(-90 18 ${margin.top + plotHeight / 2})`, 'text-anchor': 'middle' });
    const layer = svgElement('g', { class: 'heatmap-cells' });
    shell.svg.append(layer);
    const cells = yLabels.flatMap((rowLabel, row) => xLabels.map((columnLabel, column) => ({ row, column, rowLabel, columnLabel, value: values[row]?.[column] })));
    const draw = count => {
      layer.replaceChildren();
      cells.slice(0, count).forEach(cell => {
        const rect = svgElement('rect', { x: margin.left + cell.column * cellWidth, y: margin.top + cell.row * cellHeight, width: cellWidth, height: cellHeight, fill: color(cell.value), class: 'interactive-mark' });
        layer.append(rect);
        bindTooltip(shell, rect, `${cell.rowLabel} · ${cell.columnLabel}`, [`value  ${formatNumber(cell.value)}`]);
      });
    };
    if (config.animated === false) {
      draw(cells.length);
      return { restart: () => draw(cells.length), prepare: () => draw(cells.length) };
    }
    return attachStepPlayback(shell, cells.length, draw, number(config.revealDelay, 90));
  }

  function renderError(host, message) {
    host.className = 'figure-config-error';
    host.textContent = message;
    return { restart() {}, prepare() {} };
  }

  function renderSingle(host, config) {
    const type = String(config.type || '').toLowerCase();
    if (type === 'line') return renderLine(host, config);
    if (type === 'bar') return renderBar(host, config);
    if (type === 'scatter') return renderScatter(host, config);
    if (type === 'heatmap') return renderHeatmap(host, config);
    return renderError(host, `Unsupported figure type: ${type || 'missing type'}.`);
  }

  function observe(target, controller) {
    if (observed.has(target)) return;
    observed.add(target);
    target.setAttribute('data-figure-runtime-root', '');
    controller.prepare();
    let wasVisible = false;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        const fullyVisible = entry.isIntersecting && entry.intersectionRatio >= .96;
        if (fullyVisible && !wasVisible) controller.restart();
        wasVisible = fullyVisible;
      });
    }, { threshold: [0, .96, 1] });
    observer.observe(target);
    registrations.set(target, { observer, controller });
  }

  function renderCarousel(host, config) {
    const figures = Array.isArray(config.figures) ? config.figures : [];
    if (!figures.length) return renderError(host, 'A carousel needs a figures array.');
    const section = document.createElement('section');
    section.className = 'multi-figure-carousel generated-figure-carousel';
    section.setAttribute('aria-label', config.ariaLabel || 'Swipeable figure group');
    const previous = document.createElement('button');
    previous.type = 'button';
    previous.className = 'carousel-arrow carousel-arrow-previous';
    previous.setAttribute('aria-label', 'Previous figure');
    previous.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m15 5-7 7 7 7"/></svg>';
    const next = document.createElement('button');
    next.type = 'button';
    next.className = 'carousel-arrow carousel-arrow-next';
    next.setAttribute('aria-label', 'Next figure');
    next.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="m9 5 7 7-7 7"/></svg>';
    const viewport = document.createElement('div');
    viewport.className = 'subfigure-carousel';
    const track = document.createElement('div');
    track.className = 'subfigure-track';
    track.tabIndex = 0;
    const dots = document.createElement('div');
    dots.className = 'subfigure-pagination';
    viewport.append(track, dots);
    section.append(previous, viewport, next);
    host.replaceWith(section);
    const controllers = figures.map((figureConfig, index) => {
      const figure = document.createElement('figure');
      figure.className = 'carousel-figure';
      track.append(figure);
      const controller = renderSingle(figure, figureConfig);
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', `Show figure ${index + 1}`);
      dot.setAttribute('aria-current', String(index === 0));
      dots.append(dot);
      return controller;
    });
    let active = 0;
    const show = index => {
      active = clamp(index, 0, figures.length - 1);
      track.scrollTo({ left: active * track.clientWidth, behavior: 'smooth' });
      [...dots.children].forEach((dot, dotIndex) => dot.setAttribute('aria-current', String(dotIndex === active)));
      previous.disabled = active === 0;
      next.disabled = active === figures.length - 1;
      controllers[active].restart();
    };
    previous.addEventListener('click', () => show(active - 1));
    next.addEventListener('click', () => show(active + 1));
    [...dots.children].forEach((dot, index) => dot.addEventListener('click', () => show(index)));
    let scrollFrame = 0;
    track.addEventListener('scroll', () => {
      window.cancelAnimationFrame(scrollFrame);
      scrollFrame = window.requestAnimationFrame(() => {
        const index = clamp(Math.round(track.scrollLeft / Math.max(track.clientWidth, 1)), 0, figures.length - 1);
        if (index !== active) show(index);
      });
    });
    track.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      show(active + (event.key === 'ArrowRight' ? 1 : -1));
    });
    show(0);
    observe(section, { prepare: () => controllers.forEach(controller => controller.prepare()), restart: () => controllers[active].restart() });
    return section;
  }

  function renderHost(host) {
    if (host.dataset.figureRendered === 'true') return;
    const config = parseConfig(host);
    if (!config) {
      renderError(host, 'This figure configuration is not valid JSON.');
      return;
    }
    host.dataset.figureRendered = 'true';
    if (config.type === 'carousel') {
      renderCarousel(host, config);
      return;
    }
    const controller = renderSingle(host, config);
    observe(host, controller);
  }

  function renderAll(root = document) {
    root.querySelectorAll('[data-scientific-figure]').forEach(renderHost);
  }

  function destroyAll(root = document) {
    root.querySelectorAll('[data-figure-runtime-root]').forEach(target => {
      const registration = registrations.get(target);
      registration?.observer.disconnect();
      registration?.controller.prepare();
      registrations.delete(target);
      observed.delete(target);
    });
  }

  window.ScientificFigures = { renderAll, destroyAll };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => renderAll());
  else renderAll();
})();
