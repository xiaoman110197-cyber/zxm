const modules = [
  '../api/analyze-file.js',
  '../api/diagnosis.js',
  '../api/report.js',
  '../api/health.js'
];

await Promise.all(modules.map((path) => import(path)));
console.info(`Verified ${modules.length} server API modules`);
