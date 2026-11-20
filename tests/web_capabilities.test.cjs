const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    matchesCapabilityQuery,
    filterCapabilityItems,
    formatMcpToolsPreview,
} = require('../channel/web/static/js/views/skills.js');

test('capabilities multi-token search matches across fields case-insensitively', () => {
    assert.equal(matchesCapabilityQuery(['web_search', 'Search the internet'], ''), true);
    assert.equal(matchesCapabilityQuery(['web_search', 'Search the internet'], 'SEARCH internet'), true);
    assert.equal(matchesCapabilityQuery(['web_search', 'Search the internet'], 'fetch url'), false);

    const servers = [
        { name: 'github', url: '', tools: [{ name: 'create_issue', description: 'Open GitHub issue' }] },
        { name: 'fetch', url: 'https://mcp.example/sse', tools: [{ name: 'fetch_url', description: 'Read page' }] },
    ];
    const hits = filterCapabilityItems(servers, 'create_issue', (s) => [
        s.name,
        s.url,
        ...(s.tools || []).map(t => `${t.name} ${t.description}`),
    ]);
    assert.deepEqual(hits.map(s => s.name), ['github']);
});

test('formatMcpToolsPreview truncates long lists unless expanded', () => {
    const tools = Array.from({ length: 8 }, (_, idx) => ({ name: `tool_${idx + 1}`, description: 'desc' }));
    const collapsed = formatMcpToolsPreview(tools, false, 5);
    assert.equal(collapsed.visibleTools.length, 5);
    assert.equal(collapsed.hiddenCount, 3);
    assert.equal(collapsed.total, 8);

    const expanded = formatMcpToolsPreview(tools, true, 5);
    assert.equal(expanded.visibleTools.length, 8);
    assert.equal(expanded.hiddenCount, 0);
});

test('capabilities HTML, JS actions, and i18n translations wire search and MCP diagnostics', () => {
    const html = fs.readFileSync(path.join(__dirname, '../channel/web/templates/views/skills.html'), 'utf8');
    assert.ok(html.includes('id="capabilities-search"'));
    assert.ok(html.includes('id="capabilities-search-clear"'));
    assert.ok(html.includes('id="capabilities-search-empty"'));

    const js = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/views/skills.js'), 'utf8');
    assert.ok(js.includes('/api/mcp/servers/reload'));
    assert.ok(js.includes('data-mcp-reload'));
    assert.ok(js.includes('data-mcp-switch'));
    assert.ok(js.includes('mcp-card-error'));

    const i18nDir = path.join(__dirname, '../channel/web/static/js/core/i18n');
    const i18n = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/core/i18n.js'), 'utf8')
        + ['zh.js', 'zh-Hant.js', 'en.js'].map((f) => fs.readFileSync(path.join(i18nDir, f), 'utf8')).join('\n');
    for (const key of ['capabilities_search_ph', 'mcp_tools_count', 'mcp_reload', 'skill_badge_builtin']) {
        const matches = i18n.match(new RegExp(`\\b${key}:`, 'g')) || [];
        assert.ok(matches.length >= 3, `${key} should exist in zh, zh-Hant, and en`);
    }
});
