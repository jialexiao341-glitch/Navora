const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const {
    createTeamCollabTracker,
    resolveSubagentLabel,
} = require('../channel/web/static/js/chat/team-collab.js');

test('single-agent turn without delegation or subagent keeps strip hidden', () => {
    const tracker = createTeamCollabTracker();
    tracker.startTurn({ id: 'main', name: 'Navora' });
    tracker.applyEvent({ type: 'reasoning', content: 'thinking' });
    tracker.applyEvent({ type: 'tool_start', tool: 'read', tool_call_id: 't1' });
    assert.equal(tracker.snapshot().visible, false);
    tracker.applyEvent({ type: 'tool_end', tool_call_id: 't1', status: 'success' });
    tracker.applyEvent({ type: 'done', content: 'ok' });
    const snap = tracker.snapshot();
    assert.equal(snap.visible, false);
    assert.equal(snap.settled, true);
});

test('team delegation tracks waiting owner and peer execution through peer_end and done', () => {
    const tracker = createTeamCollabTracker();
    tracker.startTurn({ id: 'main', name: 'Orchestrator' });
    tracker.applyEvent({ type: 'tool_start', tool: 'agent_delegate', tool_call_id: 'del1' });

    let snap = tracker.snapshot();
    assert.equal(snap.visible, true);
    assert.equal(snap.participants.length, 1);
    assert.equal(snap.participants[0].currentTool, 'agent_delegate');

    tracker.applyEvent({ type: 'peer_start', agent_id: 'coder', agent_name: 'Coder', card_id: 'del1' });
    snap = tracker.snapshot();
    assert.equal(snap.participants.length, 2);
    assert.equal(snap.participants[0].status, 'waiting');
    assert.equal(snap.participants[1].name, 'Coder');
    assert.equal(snap.participants[1].status, 'running');

    tracker.applyEvent({ type: 'tool_start', tool: 'edit', tool_call_id: 'e1' });
    snap = tracker.snapshot();
    assert.equal(snap.participants[1].currentTool, 'edit');
    assert.equal(snap.participants[1].stepCount, 1);

    tracker.applyEvent({ type: 'tool_end', tool_call_id: 'e1', status: 'success' });
    tracker.applyEvent({ type: 'peer_end' });
    snap = tracker.snapshot();
    assert.equal(snap.participants[1].status, 'done');
    assert.equal(snap.participants[0].status, 'running');

    tracker.applyEvent({ type: 'tool_end', tool_call_id: 'del1', status: 'success' });
    tracker.applyEvent({ type: 'done', content: 'all good' });
    snap = tracker.snapshot();
    assert.equal(snap.settled, true);
    assert.equal(snap.runningCount, 0);
    assert.equal(snap.doneCount, 2);
});

test('subagent calls and subagent_step progress track parallel branches and errors', () => {
    const tracker = createTeamCollabTracker();
    tracker.startTurn({ id: 'main', name: 'Lead' });
    tracker.applyEvent({
        type: 'tool_start',
        tool: 'subagent',
        tool_call_id: 'sub1',
        arguments: { role: 'Code Reviewer', task: 'Inspect module' },
    });
    tracker.applyEvent({
        type: 'tool_start',
        tool: 'subagent',
        tool_call_id: 'sub2',
        arguments: { description: 'Search docs for latest API change' },
    });

    assert.equal(
        resolveSubagentLabel({ tool: 'subagent', arguments: { role: 'Reviewer' } }),
        'Reviewer'
    );

    tracker.applyEvent({ type: 'subagent_step', card_id: 'sub1', step_id: 's1', phase: 'start', tool: 'read' });
    tracker.applyEvent({ type: 'subagent_step', card_id: 'sub2', step_id: 's2', phase: 'start', tool: 'web_search' });
    let snap = tracker.snapshot();
    assert.equal(snap.visible, true);
    assert.equal(snap.participants.length, 3);
    assert.equal(snap.participants[1].currentTool, 'read');
    assert.equal(snap.participants[1].stepCount, 1);
    assert.equal(snap.participants[2].currentTool, 'web_search');

    tracker.applyEvent({ type: 'subagent_step', card_id: 'sub1', step_id: 's1', phase: 'end', status: 'error' });
    tracker.applyEvent({ type: 'tool_end', tool_call_id: 'sub1', status: 'error', execution_time: 1.4 });
    tracker.applyEvent({ type: 'subagent_step', card_id: 'sub2', step_id: 's2', phase: 'end', status: 'success' });
    tracker.applyEvent({ type: 'tool_end', tool_call_id: 'sub2', status: 'success', execution_time: 0.9 });
    tracker.applyEvent({ type: 'done' });

    snap = tracker.snapshot();
    assert.equal(snap.participants[1].status, 'error');
    assert.equal(snap.participants[1].failedSteps, 1);
    assert.equal(snap.participants[2].status, 'done');
    assert.equal(snap.errorCount, 1);
    assert.equal(snap.doneCount, 2);

    tracker.dismiss();
    assert.equal(tracker.snapshot().visible, false);
});

test('chat HTML, script order, and i18n translations wire team-collab strip cleanly', () => {
    const chatHtml = fs.readFileSync(path.join(__dirname, '../channel/web/chat.html'), 'utf8');
    const collabIdx = chatHtml.indexOf('/assets/js/chat/team-collab.js');
    const sendIdx = chatHtml.indexOf('/assets/js/chat/send.js');
    assert.ok(collabIdx > 0);
    assert.ok(sendIdx > collabIdx, 'team-collab.js must load before send.js');

    const chatView = fs.readFileSync(path.join(__dirname, '../channel/web/templates/views/chat.html'), 'utf8');
    assert.ok(chatView.includes('id="team-collab-strip"'));

    const i18nSrc = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/core/i18n.js'), 'utf8');
    for (const key of ['collab_title', 'pet_phase_handoff', 'pet_phase_subagent', 'substep_count_many']) {
        const matches = i18nSrc.match(new RegExp(`\\b${key}:`, 'g')) || [];
        assert.ok(matches.length >= 3, `${key} should appear in zh, zh-Hant, and en`);
    }

    const renderSrc = fs.readFileSync(path.join(__dirname, '../channel/web/static/js/chat/render.js'), 'utf8');
    assert.ok(renderSrc.includes('knowledge_ref'));
    assert.ok(renderSrc.includes('memory_ref'));
});
