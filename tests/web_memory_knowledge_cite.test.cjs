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

    assert.match(knowledgeHtml, /id="knowledge-search-results"/);
    assert.match(knowledgeHtml, /id="knowledge-btn-cite"/);

    assert.match(memoryJs, /\/api\/memory\/search/);
    assert.match(memoryJs, /citeMemoryToChat/);
    assert.match(knowledgeJs, /\/api\/knowledge\/search/);
    assert.match(knowledgeJs, /citeCurrentKnowledgeToChat/);

    assert.match(workspaceJs, /function addCitationAttachment/);
    assert.match(workspaceJs, /updateHashMentionQuery/);
    assert.ok(workspaceJs.includes('/(?:^|\\s)#([^\\s#]*)$/'));
    assert.match(stateJs, /att\.file_type === 'knowledge_ref'/);
    assert.match(stateJs, /att\.file_type === 'memory_ref'/);
});
