/** Current boundaries: ARCHITECTURE.md. No baseline suppressions. */
module.exports = {
  forbidden: [
    { name: 'no-cycles', severity: 'error', from: {}, to: { circular: true } },
    { name: 'no-unresolved', severity: 'error', from: {}, to: { couldNotResolve: true } },
    {
      name: 'features-do-not-import-entrypoints', severity: 'error',
      from: { path: '^static/', pathNot: '^static/js/(?:admin/)?app\\.js$' },
      to: { path: '^static/js/(?:admin/)?app\\.js$' },
    },
    {
      name: 'public-ui-does-not-import-admin', severity: 'error',
      from: { path: '^static/js/', pathNot: '^static/js/admin/' },
      to: { path: '^static/js/admin/' },
    },
    {
      name: 'shared-core-does-not-import-ui', severity: 'error',
      from: { path: '^static/js/(?:api|utils|pdf-paper|pdf-engine|pdf-preview-controller|motion|dialog-api|service-worker-registration)\\.js$' },
      to: { path: '^static/js/(?:admin/|app\\.js$|upload\\.js$|history\\.js$|preview\\.js$|gift-card\\.js$)' },
    },
    { name: 'no-orphans', severity: 'warn', from: { orphan: true, pathNot: '^static/js/(?:admin/)?app\\.js$|^static/js/theme-bootstrap\\.js$' }, to: {} },
  ],
  options: {
    doNotFollow: { path: 'node_modules|static/pdfjs|static/builds' },
    exclude: { path: 'static/pdfjs|static/builds' },
    enhancedResolveOptions: { exportsFields: ['exports'], conditionNames: ['import', 'browser', 'default'] },
  },
};
