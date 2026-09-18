export const DEMO_FILE_FIXTURES = Object.freeze([
  Object.freeze({
    name:'mobile-call-review.svg',
    mimeType:'image/svg+xml',
    conversationSlug:'product',
    uploader:'anna',
    body:`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="560" viewBox="0 0 900 560"><rect width="900" height="560" rx="32" fill="#111214"/><rect x="40" y="38" width="820" height="72" rx="22" fill="#1f2225"/><circle cx="80" cy="74" r="18" fill="#d4a28b"/><rect x="116" y="60" width="230" height="18" rx="9" fill="#e9e7e2"/><rect x="40" y="136" width="520" height="344" rx="28" fill="#24272a"/><rect x="580" y="136" width="280" height="164" rx="28" fill="#2e3135"/><rect x="580" y="320" width="280" height="160" rx="28" fill="#1b1e21"/><rect x="260" y="504" width="380" height="34" rx="17" fill="#e9e7e2"/><text x="450" y="92" text-anchor="middle" fill="#96999d" font-family="Arial" font-size="18">Mobile call QA · safe area · reconnect · controls</text></svg>`,
  }),
  Object.freeze({
    name:'release-checklist.md',
    mimeType:'text/markdown',
    conversationSlug:'product',
    uploader:'anna',
    body:'# Mobile release checklist\n\n- iPhone safe-area\n- reconnect state\n- incoming push call\n- camera / microphone permissions\n- background / foreground recovery\n- final visual QA\n',
  }),
  Object.freeze({
    name:'launch-metrics.csv',
    mimeType:'text/csv',
    conversationSlug:'operations',
    uploader:'ilya',
    body:'metric,owner,status\nMobile QA,Maxim,in_progress\nUX review,Anna,in_review\nRelease checklist,Ilya,blocked\nRBAC,Elena,accepted\n',
  }),
]);
