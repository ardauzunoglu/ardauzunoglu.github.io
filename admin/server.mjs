import { createServer } from 'node:http';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const execFileAsync = promisify(execFile);
const serverFile = fileURLToPath(import.meta.url);
const adminDirectory = dirname(serverFile);
const repositoryRoot = resolve(adminDirectory, '..');
const blogIndexPath = join(repositoryRoot, 'blog', 'index.html');
const startMarker = '<!-- BLOG_ENTRIES_START -->';
const endMarker = '<!-- BLOG_ENTRIES_END -->';
const bodyLimit = 5 * 1024 * 1024;
const sessionCookieName = 'blog_admin_session';
const sessionLifetimeSeconds = 12 * 60 * 60;
const loginWindowMilliseconds = 10 * 60 * 1000;
const maximumLoginAttempts = 5;
const contentTypes = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml'
};

const indent = (value, spaces = 10) => value.split('\n').map(line => `${' '.repeat(spaces)}${line}`).join('\n');
const normalizeEntry = value => {
  const lines = value.trim().split('\n');
  const nonEmpty = lines.filter(line => line.trim());
  const leading = nonEmpty.length ? Math.min(...nonEmpty.map(line => line.match(/^\s*/)[0].length)) : 0;
  return lines.map(line => line.slice(Math.min(leading, line.length))).join('\n').trim();
};
const entryMonth = entry => entry.match(/<time\s+datetime="(\d{4}-\d{2})"/)?.[1] || '0000-00';

export function updateBlogIndex(indexHtml, indexEntry, slug) {
  const start = indexHtml.indexOf(startMarker);
  const end = indexHtml.indexOf(endMarker);
  if (start < 0 || end < 0 || end <= start) throw new Error('Blog entry markers are missing from blog/index.html.');
  const normalizedNewEntry = normalizeEntry(indexEntry);
  if (!normalizedNewEntry.includes(`href="./${slug}/index.html"`)) throw new Error('The generated blog entry does not match the post slug.');
  const existingRegion = indexHtml.slice(start + startMarker.length, end);
  const entries = [...existingRegion.matchAll(/<a\s+class="blog-entry"[\s\S]*?<\/a>/g)]
    .map(match => normalizeEntry(match[0]))
    .filter(entry => !entry.includes(`href="./${slug}/index.html"`));
  entries.unshift(normalizedNewEntry);
  entries.sort((first, second) => entryMonth(second).localeCompare(entryMonth(first)));
  const replacement = `${startMarker}\n${entries.map(entry => indent(entry)).join('\n')}\n          ${endMarker}`;
  return `${indexHtml.slice(0, start)}${replacement}${indexHtml.slice(end + endMarker.length)}`;
}

function safeRepositoryPath(urlPath) {
  const decoded = decodeURIComponent(urlPath.split('?')[0]);
  const relativePath = decoded === '/' ? 'admin/index.html' : decoded.replace(/^\/+/, '');
  const topLevel = relativePath.split('/')[0];
  const allowedRootFile = ['index.html', 'styles.css', 'figure-runtime.js', 'reader-gate.js'].includes(relativePath);
  const allowedDirectory = ['blog', 'awards', 'assets'].includes(topLevel);
  const allowedAdminFile = ['admin/index.html', 'admin/admin.css', 'admin/admin.js'].includes(relativePath);
  if (!allowedRootFile && !allowedDirectory && !allowedAdminFile) return null;
  const target = resolve(repositoryRoot, relativePath);
  const outsideRepository = isAbsolute(relative(repositoryRoot, target)) || relative(repositoryRoot, target).startsWith(`..${sep}`) || relative(repositoryRoot, target) === '..';
  if (outsideRepository) return null;
  return target;
}

async function readRequestJson(request) {
  const chunks = [];
  let size = 0;
  for await (const chunk of request) {
    size += chunk.length;
    if (size > bodyLimit) throw new Error('The post is larger than the 5 MB publishing limit.');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

function sendJson(response, status, body, headers = {}) {
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers });
  response.end(JSON.stringify(body));
}

function hashSecret(value) {
  return createHash('sha256').update(String(value)).digest();
}

export function passwordMatches(candidate, expected) {
  return timingSafeEqual(hashSecret(candidate), hashSecret(expected));
}

function parseCookies(request) {
  return Object.fromEntries(String(request.headers.cookie || '').split(';').map(part => {
    const separator = part.indexOf('=');
    if (separator < 0) return ['', ''];
    return [part.slice(0, separator).trim(), decodeURIComponent(part.slice(separator + 1).trim())];
  }).filter(([name]) => name));
}

async function runGit(args) {
  return execFileAsync('git', args, { cwd: repositoryRoot, maxBuffer: 1024 * 1024 });
}

export async function publishPost(payload, dryRun = false) {
  const slug = String(payload.slug || '').trim();
  const title = String(payload.title || '').trim();
  const html = String(payload.html || '');
  const indexEntry = String(payload.indexEntry || '');
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) throw new Error('The slug must contain lowercase letters, numbers, and single hyphens only.');
  if (!title) throw new Error('The post title is missing.');
  if (!html.startsWith('<!DOCTYPE html>') || !html.includes('../../figure-runtime.js')) throw new Error('The generated post HTML is incomplete.');

  const branch = (await runGit(['branch', '--show-current'])).stdout.trim();
  if (branch !== 'main') throw new Error(`Publishing is only enabled on main; the current branch is ${branch || 'detached'}.`);
  const staged = (await runGit(['diff', '--cached', '--name-only'])).stdout.trim();
  if (staged) throw new Error(`The Git staging area is not empty. Commit or unstage these files first:\n${staged}`);

  const currentIndex = await readFile(blogIndexPath, 'utf8');
  const nextIndex = updateBlogIndex(currentIndex, indexEntry, slug);
  const postDirectory = join(repositoryRoot, 'blog', slug);
  const postPath = join(postDirectory, 'index.html');
  if (dryRun) return { slug, postPath: relative(repositoryRoot, postPath), message: 'Dry run passed; no files were changed.' };

  await mkdir(postDirectory, { recursive: true });
  await writeFile(postPath, html, 'utf8');
  await writeFile(blogIndexPath, nextIndex, 'utf8');
  await runGit(['add', '--', 'admin', 'figure-runtime.js', 'reader-gate.js', 'styles.css', 'blog']);

  let changed = true;
  try {
    await runGit(['diff', '--cached', '--quiet']);
    changed = false;
  } catch (error) {
    if (error.code !== 1) throw error;
  }
  if (changed) {
    const messageTitle = title.replace(/[\r\n]+/g, ' ').slice(0, 100);
    await runGit(['commit', '-m', `Publish blog post: ${messageTitle}`]);
  }
  try {
    await runGit(['push', 'origin', 'main']);
  } catch (error) {
    const details = String(error.stderr || error.message || '').trim();
    const publishError = new Error(`The post was committed locally, but git push failed.${details ? ` ${details}` : ''}`);
    publishError.committed = true;
    throw publishError;
  }
  return {
    slug,
    postPath: relative(repositoryRoot, postPath),
    message: changed ? 'Published and pushed to GitHub.' : 'The post was already committed; main is synchronized with GitHub.'
  };
}

export function createPublisherServer({ dryRun = false, password = process.env.BLOG_ADMIN_PASSWORD } = {}) {
  if (!password) throw new Error('Set BLOG_ADMIN_PASSWORD before starting the publisher.');
  const sessions = new Map();
  const failedLogins = new Map();

  const getSession = request => {
    const token = parseCookies(request)[sessionCookieName];
    const expiresAt = token ? sessions.get(token) : 0;
    if (!expiresAt) return null;
    if (expiresAt <= Date.now()) {
      sessions.delete(token);
      return null;
    }
    return token;
  };

  const clientIsRateLimited = request => {
    const address = request.socket.remoteAddress || 'local';
    const cutoff = Date.now() - loginWindowMilliseconds;
    const attempts = (failedLogins.get(address) || []).filter(timestamp => timestamp > cutoff);
    failedLogins.set(address, attempts);
    return attempts.length >= maximumLoginAttempts;
  };

  const recordFailedLogin = request => {
    const address = request.socket.remoteAddress || 'local';
    failedLogins.set(address, [...(failedLogins.get(address) || []), Date.now()]);
  };

  const server = createServer(async (request, response) => {
    try {
      const requestUrl = new URL(request.url, 'http://127.0.0.1');
      if (request.method === 'GET' && requestUrl.pathname === '/api/auth/status') {
        sendJson(response, 200, { ok: true, available: true, authenticated: Boolean(getSession(request)) });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/login') {
        if (clientIsRateLimited(request)) {
          sendJson(response, 429, { ok: false, message: 'Too many incorrect attempts. Try again in ten minutes.' });
          return;
        }
        const body = await readRequestJson(request);
        if (!passwordMatches(body.password || '', password)) {
          recordFailedLogin(request);
          sendJson(response, 401, { ok: false, message: 'Incorrect password.' });
          return;
        }
        failedLogins.delete(request.socket.remoteAddress || 'local');
        const sessionToken = randomBytes(32).toString('hex');
        sessions.set(sessionToken, Date.now() + sessionLifetimeSeconds * 1000);
        sendJson(response, 200, { ok: true, authenticated: true }, {
          'set-cookie': `${sessionCookieName}=${sessionToken}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${sessionLifetimeSeconds}`
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/auth/logout') {
        const sessionToken = getSession(request);
        if (sessionToken) sessions.delete(sessionToken);
        sendJson(response, 200, { ok: true, authenticated: false }, {
          'set-cookie': `${sessionCookieName}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`
        });
        return;
      }
      if (request.method === 'POST' && requestUrl.pathname === '/api/publish') {
        if (!getSession(request)) {
          sendJson(response, 401, { ok: false, message: 'Unlock publishing before publishing this post.' });
          return;
        }
        const result = await publishPost(await readRequestJson(request), dryRun);
        sendJson(response, 200, { ok: true, ...result });
        return;
      }
      if (request.method !== 'GET') {
        sendJson(response, 405, { ok: false, message: 'Method not allowed.' });
        return;
      }
      if (requestUrl.pathname === '/') {
        response.writeHead(302, { location: '/admin/index.html', 'cache-control': 'no-store' });
        response.end();
        return;
      }
      const target = safeRepositoryPath(requestUrl.pathname);
      if (!target) {
        response.writeHead(403);
        response.end('Forbidden');
        return;
      }
      if (target === join(adminDirectory, 'index.html')) {
        const html = await readFile(target, 'utf8');
        response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        response.end(html);
        return;
      }
      const contents = await readFile(target);
      response.writeHead(200, { 'content-type': contentTypes[extname(target).toLowerCase()] || 'application/octet-stream', 'cache-control': 'no-store' });
      response.end(contents);
    } catch (error) {
      if (error.code === 'ENOENT') {
        response.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' });
        response.end('Not found');
        return;
      }
      sendJson(response, error.committed ? 502 : 400, { ok: false, committed: Boolean(error.committed), message: error.message || 'Publishing failed.' });
    }
  });
  return { server };
}

async function selfTest() {
  const sample = `<div class="blog-list">\n          ${startMarker}\n          <a class="blog-entry" href="./older/index.html"><time datetime="2025-04">Apr 2025</time></a>\n          ${endMarker}\n        </div>`;
  const newer = '<a class="blog-entry" href="./new-post/index.html"><time datetime="2026-08">Aug 2026</time></a>';
  const updated = updateBlogIndex(sample, newer, 'new-post');
  if (updated.indexOf('new-post') > updated.indexOf('older')) throw new Error('Blog entries were not sorted newest first.');
  const replacement = '<a class="blog-entry" href="./new-post/index.html"><time datetime="2027-01">Jan 2027</time></a>';
  const replaced = updateBlogIndex(updated, replacement, 'new-post');
  if ((replaced.match(/new-post/g) || []).length !== 1 || !replaced.includes('2027-01')) throw new Error('Existing entries were not replaced cleanly.');
  if (!passwordMatches('correct horse battery staple', 'correct horse battery staple')) throw new Error('Matching passwords were rejected.');
  if (passwordMatches('correct horse battery staple', 'incorrect password')) throw new Error('Incorrect passwords were accepted.');
  console.log('Publisher self-test passed.');
}

if (process.argv.includes('--self-test')) {
  await selfTest();
} else if (resolve(process.argv[1] || '') === serverFile) {
  const port = Number(process.env.BLOG_ADMIN_PORT || 4173);
  const dryRun = process.env.BLOG_PUBLISH_DRY_RUN === '1';
  const password = process.env.BLOG_ADMIN_PASSWORD;
  if (!password) {
    console.error("Set a private password first: BLOG_ADMIN_PASSWORD='your-password' node admin/server.mjs");
    process.exitCode = 1;
  } else {
    const { server } = createPublisherServer({ dryRun, password });
    server.listen(port, '127.0.0.1', () => {
      console.log(`Blog admin: http://127.0.0.1:${port}/admin/index.html`);
      console.log('Publishing is password-protected; the password is never sent to or stored by GitHub Pages.');
      if (dryRun) console.log('Dry-run mode is enabled; publishing will not change files or run git commands.');
      console.log('Press Ctrl+C to stop the local publisher.');
    });
  }
}
