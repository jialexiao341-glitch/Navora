const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..');

test('highlightSearchTerms escapes HTML safely and marks matched keywords', () => {
    const code = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/core/utils.js'), 'utf8');
    const sandbox = {
        document: {
            createElement: () => ({
                _text: '',
                appendChild(node) { this._text = node.text; },
                get innerHTML() {
                    return String(this._text)
                        .replace(/&/g, '&amp;')
                        .replace(/</g, '&lt;')
                        .replace(/>/g, '&gt;');
                },
            }),
            createTextNode: (text) => ({ text }),
        },
        window: {},
    };
    vm.runInNewContext(code, sandbox);

    const out = sandbox.highlightSearchTerms('<script>Hybrid RAG</script> notes', 'RAG <script>');
    assert.match(out, /&lt;mark|<mark/);
    assert.ok(!out.includes('<script>'));
    assert.match(out, /<mark[^>]*>RAG<\/mark>/);
});

test('memory, knowledge, and chat views expose search and citation hooks', () => {
    const memoryHtml = fs.readFileSync(path.join(ROOT, 'channel/web/templates/views/memory.html'), 'utf8');
    const knowledgeHtml = fs.readFileSync(path.join(ROOT, 'channel/web/templates/views/knowledge.html'), 'utf8');
    const memoryJs = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/views/memory.js'), 'utf8');
    const knowledgeJs = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/views/knowledge.js'), 'utf8');
    const workspaceJs = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/workspace.js'), 'utf8');
    const stateJs = fs.readFileSync(path.join(ROOT, 'channel/web/static/js/chat/state.js'), 'utf8');

    assert.match(memoryHtml, /id="memory-search-input"/);
    assert.match(memoryHtml, /id="memory-search-results"/);
    assert.match(memoryHtml, /id="memory-btn-cite"/);
    assert.match(memoryHtml, /id="memory-index-card"/);
    assert.match(memoryHtml, /id="memory-rebuild-btn"/);
    assert.match(memoryHtml, /id="evolution-backups-section"/);
    assert.match(memoryHtml, /id="memory-panel-diff"/);

    assert.match(knowledgeHtml, /id="knowledge-search-results"/);
    assert.match(knowledgeHtml, /id="knowledge-btn-cite"/);

    assert.match(memoryJs, /\/api\/memory\/search/);
    assert.match(memoryJs, /\/api\/memory\/index/);
    assert.match(memoryJs, /\/api\/memory\/index\/rebuild/);
    assert.match(memoryJs, /\/api\/memory\/evolution\/backups/);
    assert.match(memoryJs, /\/api\/memory\/evolution\/diff/);
    assert.match(memoryJs, /\/api\/memory\/evolution\/restore/);
    assert.match(memoryJs, /citeMemoryToChat/);
    assert.match(knowledgeJs, /\/api\/knowledge\/search/);
    assert.match(knowledgeJs, /citeCurrentKnowledgeToChat/);

    assert.match(workspaceJs, /function addCitationAttachment/);
    assert.match(workspaceJs, /updateHashMentionQuery/);
    assert.ok(workspaceJs.includes('/(?:^|\\s)#([^\\s#]*)$/'));
    assert.match(stateJs, /att\.file_type === 'knowledge_ref'/);
    assert.match(stateJs, /att\.file_type === 'memory_ref'/);
});

test('memory view helpers format index warnings and escape unified diff safely', () => {
    const { formatMemoryIndexWarnings, renderUnifiedDiffHtml } = require('../channel/web/static/js/views/memory.js');

    const warnings = formatMemoryIndexWarnings({
        warnings: ['missing_vectors', 'dim_mismatch', 'chunker_outdated'],
        missing_chunks: 4,
        index_dim: 768,
        embedding_dim: 1536,
    });
    assert.equal(warnings.length, 3);
    assert.ok(warnings[0].text.includes('4'));
    assert.ok(warnings[1].text.includes('768'));
    assert.ok(warnings[1].text.includes('1536'));

    const diffHtml = renderUnifiedDiffHtml('--- snapshot/a.md\n+++ current/a.md\n@@ -1 +1 @@\n-old <tag>\n+new <script>alert(1)</script>');
    assert.ok(!diffHtml.includes('<script>'));
    assert.match(diffHtml, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
    assert.match(diffHtml, /text-emerald-700/);
    assert.match(diffHtml, /text-rose-700/);
});
