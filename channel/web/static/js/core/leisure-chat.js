function appendLeisurePrompt(draft, prompt) {
    return draft ? draft + (draft.endsWith('\n\n') ? '' : draft.endsWith('\n') ? '\n' : '\n\n') + prompt : prompt;
}
if (typeof module !== 'undefined' && module.exports) module.exports = {appendLeisurePrompt};
if (typeof document !== 'undefined') (() => {
    const view = document.getElementById('ambient-leisure-view');
    if (!view) return;
    view.querySelectorAll('[data-leisure]').forEach(button => button.addEventListener('click', () => {
        const input = document.getElementById('chat-input');
        if (!input) return;
        if (currentView !== 'chat' && navigateTo('chat') === false) return;
        input.value = appendLeisurePrompt(input.value, t('leisure_prompt_' + button.dataset.leisure));
        input.dispatchEvent(new Event('input', {bubbles:true}));
        const root = document.getElementById('ambient-player');
        if (!root.classList.contains('is-collapsed')) document.getElementById('ambient-toggle').click();
        input.focus();
        input.setSelectionRange(input.value.length, input.value.length);
    }));
})();
