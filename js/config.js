/* Herd Check configuration. Classic script. */
(function () {
  'use strict';
  window.HC = window.HC || {};
  window.HC.config = {
    // Public App Key (pk_...) registered for this page's address. Safe to commit.
    APP_KEY: 'pk_istj9HGSSitZ6swE',
    REPO_URL: 'https://github.com/patbing/herd-check',
    API: 'https://gen.pollinations.ai',
    TIMEOUT_MS: 90000,
    // A live run stops itself before a question whose calls could take it past this.
    MAX_SPEND: 0.03,
    MAX_MODELS: 12,
    // Worst case per call for the cap: the question in, max_tokens out.
    WORST_IN_TOKENS: 300
  };
})();
