import { existsSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const site = 'https://devkumailraza.site';
const errors = [];
const must = (condition, message) => { if (!condition) errors.push(message); };
const read = (path) => readFileSync(resolve(path), 'utf8');
const match = (text, pattern) => text.match(pattern)?.[1] ?? '';
const canonical = (html) => match(html, /<link\s+rel="canonical"\s+href="([^"]+)"/i);
const sitemap = read('public/sitemap.xml');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((x) => x[1]);

must(urls.length > 0, 'Sitemap must contain at least one URL.');
must(new Set(urls).size === urls.length, 'Duplicate sitemap URLs.');
must(urls.includes(site + '/'), 'Homepage absent from sitemap.');
must(sitemap.includes('http://www.sitemaps.org/schemas/sitemap/0.9'), 'Missing sitemap namespace.');
must(existsSync('public/robots.txt'), 'Missing robots.txt.');
if (existsSync('public/robots.txt')) {
  must(read('public/robots.txt').includes('Sitemap: ' + site + '/sitemap.xml'), 'Robots sitemap reference is wrong.');
}

for (const url of urls) {
  let parsed;
  try { parsed = new URL(url); } catch { errors.push('Invalid URL in sitemap: ' + url); continue; }
  must(parsed.origin === site, 'Unexpected sitemap origin: ' + url);
  must(!parsed.search && !parsed.hash, 'Query/fragment in sitemap: ' + url);
  const path = parsed.pathname === '/' ? 'index.html' : join('public', decodeURIComponent(parsed.pathname).replace(/^\//, ''));
  must(existsSync(path), 'Sitemap points to a missing source file: ' + path);
  if (!existsSync(path)) continue;

  const html = read(path);
  must(canonical(html) === url, 'Canonical mismatch for ' + url);
  must(Boolean(match(html, /<title>([^<]+)<\/title>/i)), 'Title missing: ' + url);
  must(/<meta\s+name="description"/i.test(html), 'Meta description missing: ' + url);
  if (parsed.pathname !== '/') {
    must((html.match(/<h1(?:\s[^>]*)?>/g) ?? []).length === 1, 'Expected one H1: ' + url);
    const scripts = [...html.matchAll(/<script\s+type="application\/ld\+json">([\s\S]*?)<\/script>/g)];
    must(scripts.length > 0, 'JSON-LD missing: ' + url);
    for (const script of scripts) {
      try { JSON.parse(script[1]); } catch { errors.push('Invalid JSON-LD in ' + url); }
    }
    const localLinks = [...html.matchAll(/href="(\/[^"#?]+(?:\.html|\.css))"/g)].map((m) => m[1]);
    for (const link of localLinks) {
      must(existsSync('public' + link), 'Broken local HTML/CSS link in ' + url + ': ' + link);
    }
  }
}

must(read('src/App.tsx').includes('sr-only'), 'The homepage H1 should include readable developer identity.');
must(read('src/App.tsx').includes('/case-studies.html'), 'Homepage should link to the case studies.');

if (existsSync('dist')) {
  for (const url of urls) {
    const path = url === site + '/' ? 'dist/index.html' : join('dist', new URL(url).pathname);
    must(existsSync(path), 'Production build missing published page: ' + path);
  }
  must(existsSync('dist/robots.txt') && existsSync('dist/sitemap.xml'), 'Build missing robots.txt or sitemap.xml.');
}

if (errors.length) {
  console.error('SEO validation failed:\n' + errors.map((e) => '- ' + e).join('\n'));
  process.exitCode = 1;
} else {
  console.log('SEO validation passed for ' + urls.length + ' canonical URLs.');
}
